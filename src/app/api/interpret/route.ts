import { NextResponse } from "next/server";
import { interpretWithGemini } from "@/lib/gemini";
import { buildClarificationPlan, extractDreamContext, type ClarificationPlan, type DreamContext } from "@/lib/dream-context";
import { indexExists, roleLabel, searchRag, type RagSearchResult } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  dream?: string;
  topK?: number;
  contextAnswers?: Record<string, string>;
  forceInterpret?: boolean;
};

type NodeTrace = {
  id: string;
  label: string;
  status: "done" | "waiting" | "skipped" | "error";
  durationMs: number;
  summary: string;
};

function pushNode(trace: NodeTrace[], id: string, label: string, startedAt: number, status: NodeTrace["status"], summary: string) {
  trace.push({ id, label, status, durationMs: Date.now() - startedAt, summary });
}

function publicWorkflow(dreamContext: DreamContext, clarificationPlan: ClarificationPlan, nodeTrace: NodeTrace[]) {
  return {
    dreamContext,
    clarificationPlan,
    questions: clarificationPlan.questions,
    answeredQuestions: clarificationPlan.answeredQuestions,
    nodeTrace,
    recommendation: clarificationPlan.note
  };
}

function serializeError(error: unknown) {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const cause = record.cause && typeof record.cause === "object" ? (record.cause as Record<string, unknown>) : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  let providerError: Record<string, unknown> | null = null;

  try {
    const parsed = JSON.parse(rawMessage) as { error?: Record<string, unknown> };
    providerError = parsed.error ?? null;
  } catch {
    providerError = null;
  }

  const details = Array.isArray(providerError?.details) ? (providerError.details as Array<Record<string, unknown>>) : [];
  const quotaFailure = details.find((item) => String(item["@type"] ?? "").includes("QuotaFailure"));
  const retryInfo = details.find((item) => String(item["@type"] ?? "").includes("RetryInfo"));
  const violations = Array.isArray(quotaFailure?.violations) ? (quotaFailure.violations as Array<Record<string, unknown>>) : [];

  return {
    name: error instanceof Error ? error.name : typeof error,
    message: String(providerError?.message ?? rawMessage),
    status: providerError?.code ?? record.status ?? record.statusCode ?? cause?.status ?? cause?.statusCode ?? null,
    code: providerError?.status ?? record.code ?? cause?.code ?? null,
    provider: providerError
      ? {
          status: providerError.status ?? null,
          code: providerError.code ?? null,
          retryDelay: retryInfo?.retryDelay ?? null,
          quota: violations[0]
            ? {
                metric: violations[0].quotaMetric ?? null,
                id: violations[0].quotaId ?? null,
                value: violations[0].quotaValue ?? null,
                dimensions: violations[0].quotaDimensions ?? null
              }
            : null
        }
      : null,
    attempts: Array.isArray(record.attempts) ? record.attempts : null,
    rawPreview: typeof record.rawPreview === "string" ? record.rawPreview : null,
    rawLength: typeof record.rawLength === "number" ? record.rawLength : null,
    stack:
      process.env.NODE_ENV !== "production" && error instanceof Error && error.stack
        ? error.stack.split("\n").slice(0, 8)
        : null
  };
}

function publicHits(search?: RagSearchResult) {
  return (
    search?.hits.map((hit) => ({
      rank: hit.rank,
      score: Number(hit.score.toFixed(3)),
      lexicalScore: Number(hit.lexicalScore.toFixed(3)),
      sourceScore: Number(hit.sourceScore.toFixed(3)),
      semanticScore: Number(hit.semanticScore.toFixed(3)),
      coverageScore: Number(hit.coverageScore.toFixed(3)),
      falseFriendPenalty: Number(hit.falseFriendPenalty.toFixed(3)),
      phraseBonus: Number(hit.phraseBonus.toFixed(3)),
      matchedTerms: hit.matchedTerms,
      matchedFocusTerms: hit.matchedFocusTerms,
      rerankReason: hit.rerankReason,
      sourceTitle: hit.chunk.sourceTitle,
      author: hit.chunk.author,
      role: hit.chunk.role,
      roleLabel: roleLabel(hit.chunk.role),
      location: hit.chunk.location,
      sourcePath: hit.chunk.sourcePath,
      excerpt: hit.excerpt,
      qualityScore: Number(hit.chunk.qualityScore.toFixed(2))
    })) ?? []
  );
}

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = `rag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let stage = "parse_body";
  let search: RagSearchResult | undefined;
  let body: RequestBody;
  const nodeTrace: NodeTrace[] = [];
  let dreamContext: DreamContext | undefined;
  let clarificationPlan: ClarificationPlan | undefined;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_JSON_BODY",
        message: "جسم الطلب ليس JSON صالح.",
        debug: {
          requestId,
          stage,
          totalMs: Date.now() - started
        }
      },
      { status: 400 }
    );
  }

  stage = "validate_input";
  const dream = String(body.dream ?? "").trim();
  const topK = Math.max(4, Math.min(16, Number(body.topK ?? 10)));

  if (dream.length < 8) {
    return NextResponse.json(
      {
        ok: false,
        error: "DREAM_TOO_SHORT",
        message: "نص الحلم قصير جدًا.",
        debug: {
          requestId,
          stage,
          dreamLength: dream.length,
          totalMs: Date.now() - started
        }
      },
      { status: 400 }
    );
  }

  stage = "extract_dream_context";
  const contextStarted = Date.now();
  dreamContext = extractDreamContext(dream);
  pushNode(
    nodeTrace,
    "extract_dream_context",
    "فهم الرائي والشخص المرئي",
    contextStarted,
    "done",
    `${dreamContext.dreamerLabel} ← الرائي، ${dreamContext.subjectLabel} ← الشخص المرئي`
  );

  stage = "clarification_gate";
  const questionsStarted = Date.now();
  const contextAnswers = body.contextAnswers && typeof body.contextAnswers === "object" ? body.contextAnswers : {};
  clarificationPlan = buildClarificationPlan(dream, dreamContext, contextAnswers);
  const shouldAsk = clarificationPlan.needsClarification && !body.forceInterpret;
  pushNode(
    nodeTrace,
    "clarification_gate",
    "قرار الأسئلة التوضيحية",
    questionsStarted,
    shouldAsk ? "waiting" : "done",
    shouldAsk ? `يحتاج ${clarificationPlan.questions.length} أسئلة قبل التفسير الأدق` : "السياق كافٍ للانتقال إلى RAG"
  );

  if (shouldAsk) {
    return NextResponse.json({
      ok: true,
      needsFollowUp: true,
      requestId,
      dream,
      message: "قبل التفسير الدقيق، يحتاج النظام إجابات قصيرة على أسئلة توضيحية.",
      workflow: publicWorkflow(dreamContext, clarificationPlan, nodeTrace),
      debug: {
        requestId,
        stage,
        topK,
        dreamLength: dream.length,
        totalMs: Date.now() - started
      }
    });
  }

  stage = "check_index";
  if (!indexExists()) {
    return NextResponse.json(
      {
        ok: false,
        error: "RAG_INDEX_MISSING",
        message: "الفهرس غير مبني بعد. شغّل: pnpm rag:build",
        debug: {
          requestId,
          stage,
          totalMs: Date.now() - started
        }
      },
      { status: 503 }
    );
  }

  try {
    stage = "rag_search";
    const ragStarted = Date.now();
    search = searchRag(dream, topK, dreamContext);
    pushNode(nodeTrace, "rag_search", "الاسترجاع وإعادة الترتيب", ragStarted, "done", `${search.hits.length} مقاطع مختارة من ${search.debug.candidatesWithScore} مرشح`);

    stage = "gemini_generate";
    const geminiStarted = Date.now();
    const interpretation = await interpretWithGemini(dream, search, { dreamContext, clarificationPlan, contextAnswers });
    pushNode(nodeTrace, "gemini_generate", "توليد جواب Gemini", geminiStarted, "done", `تم التوليد بواسطة ${interpretation.model}`);
    stage = "respond";
    const totalMs = Date.now() - started;

    return NextResponse.json({
      ok: true,
      requestId,
      dream,
      totalMs,
      interpretation,
      workflow: publicWorkflow(dreamContext, clarificationPlan, nodeTrace),
      retrieval: {
        hits: publicHits(search),
        debug: search.debug,
        index: search.index
      },
      debug: {
        requestId,
        stage,
        totalMs,
        topK,
        dreamLength: dream.length
      }
    });
  } catch (error) {
    const serialized = serializeError(error);
    const code = String(serialized.code || serialized.message || "UNKNOWN_ERROR");
    const status = code === "GEMINI_API_KEY_MISSING" ? 503 : Number(serialized.status ?? 500);
    const safeStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 500;

    console.error("[api/interpret]", {
      requestId,
      stage,
      error: serialized.message,
      name: serialized.name,
      status: serialized.status,
      code: serialized.code,
      totalMs: Date.now() - started
    });

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: code,
        message:
          code === "GEMINI_API_KEY_MISSING"
            ? "مفتاح Gemini غير موجود. ضع GOOGLE_AI_STUDIO_API_KEY في .env ثم أعد تشغيل السيرفر."
            : code === "RESOURCE_EXHAUSTED" || serialized.status === 429
              ? "Gemini رفض الطلب بسبب quota/rate limit. انتظر قليلاً أو غيّر الموديل/المفتاح."
            : stage === "gemini_generate"
              ? "فشل استدعاء Gemini أو تحليل رده. راجع تفاصيل الديباق أدناه."
              : "فشل تنفيذ مرحلة من مراحل RAG. راجع تفاصيل الديباق أدناه.",
        totalMs: Date.now() - started,
        debug: {
          requestId,
          stage,
          topK,
          dreamLength: dream.length,
          totalMs: Date.now() - started,
          error: serialized,
          retrievalAvailable: Boolean(search),
          retrievalDebug: search?.debug ?? null,
          workflow: dreamContext && clarificationPlan ? publicWorkflow(dreamContext, clarificationPlan, nodeTrace) : null
        },
        workflow: dreamContext && clarificationPlan ? publicWorkflow(dreamContext, clarificationPlan, nodeTrace) : null,
        partialRetrieval: search
          ? {
              hits: publicHits(search),
              debug: search.debug,
              index: search.index
            }
          : null
      },
      { status: safeStatus }
    );
  }
}
