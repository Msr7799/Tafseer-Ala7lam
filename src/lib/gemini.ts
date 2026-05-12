import { GoogleGenAI } from "@google/genai";
import type { RagHit, RagSearchResult } from "./rag";
import { formatAnsweredQuestions, type ClarificationPlan, type DreamContext } from "./dream-context";

export type GeminiAttempt = {
  model: string;
  attempt: number;
  durationMs: number;
  promptTokenEstimate: number;
  throttleWaitMs: number;
  success: boolean;
  error?: string;
  status?: number | string | null;
  code?: string | number | null;
  retryDelayMs?: number | null;
};

export type GeminiInterpretation = {
  answer: string;
  dreamContextSummary?: string;
  askedQuestionsUsed?: string[];
  reasoningSummary: string;
  sourceBasedPoints: string[];
  citations: Array<{
    sourceTitle: string;
    author: string;
    location: string;
    usedFor: string;
  }>;
  uncertainty: string[];
  followUpQuestions: string[];
  symbolAnalysis?: string[];
  evidenceQuality?: string;
  selfEvaluation: {
    retrievalCoverage: number;
    citationGrounding: number;
    answerCaution: number;
    notes: string;
  };
  rawText?: string;
  thoughtSummary?: string;
  model: string;
  attempts?: GeminiAttempt[];
};

export type InterpretationWorkflowContext = {
  dreamContext: DreamContext;
  clarificationPlan: ClarificationPlan;
  contextAnswers?: Record<string, string>;
};

function getApiKey() {
  return process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pickModels() {
  const primary = process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_COMPOSE_MODEL || "gemini-2.5-flash";
  const lite = process.env.GEMINI_LITE_MODEL || "gemini-2.5-flash-lite";
  const extra = (process.env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return unique([primary, ...extra, lite]);
}

function compactHit(hit: RagHit) {
  return {
    rank: hit.rank,
    sourceTitle: hit.chunk.sourceTitle,
    author: hit.chunk.author,
    role: hit.chunk.role,
    location: hit.chunk.location.label,
    score: Number(hit.score.toFixed(3)),
    matchedTerms: hit.matchedTerms,
    excerpt: hit.excerpt
  };
}

function buildPrompt(dream: string, search: RagSearchResult, workflowContext?: InterpretationWorkflowContext) {
  const context = search.hits.map(compactHit);
  const expansion = search.debug.expansion;
  const dreamContext = workflowContext?.dreamContext;
  const clarificationPlan = workflowContext?.clarificationPlan;
  const answeredQuestions = clarificationPlan ? formatAnsweredQuestions(clarificationPlan) : "لا توجد أسئلة توضيحية.";

  return `
أنت مساعد عربي متخصص في بناء جواب RAG لمشروع تفسير أحلام إسلامي.

طريقة العمل الداخلية لهذا الطلب تشبه نودز LangGraph:
1. Node: فهم سياق الرؤيا وتحديد الرائي الحقيقي.
2. Node: تحديد هل نحتاج أسئلة توضيحية.
3. Node: توسيع الرموز الحديثة إلى ألفاظ قديمة.
4. Node: استرجاع المقاطع وإعادة ترتيبها.
5. Node: صياغة جواب حذر بالمصادر.

حقائق سياق الرؤيا المستخرجة آليًا، وهي أعلى أولوية من التخمين:
${JSON.stringify(dreamContext ?? null, null, 2)}

إجابات المستخدم على الأسئلة التوضيحية، إن وجدت:
${answeredQuestions}

تعليمات الضمائر وتحديد الرائي:
- إذا كان dreamContext.isReportedDream = true، فلا تعامل المستخدم كرائي.
- إذا كان الرائي هو الأم والشخص المرئي هو المستخدم، قل: رأت أمك أنك... ولا تقل: حلمك أو رأيتَ.
- إذا كانت الرؤيا منقولة، ففسّر من زاويتين منفصلتين: خوف/انشغال الرائي الحقيقي، وحال الشخص المرئي في المنام.
- إذا نقصت بيانات العمر أو الحالة أو ظروف الواقع، اذكر أن التأويل أدق بعد معرفة تلك البيانات.

المهمة الأساسية:
- أجب عن حلم المستخدم اعتمادا على المقتطفات المسترجعة، ولا تخترع نسبة لمصدر.
- إذا لم يوجد نص مباشر، يجوز ذكر "قياس رمزي" بشرط أن تقول بوضوح إنه قياس وليس نصا من المصدر.
- لا تنسب معنى إلى ابن سيرين أو النابلسي أو ابن قتيبة إلا إذا كان ظاهرًا في المقتطف.
- الصحيحان مصادر مساندة لآداب الرؤيا والأذكار، وليسا قاموس تفسير رموز.
- تعبير الرؤيا ظني ويتغير باختلاف حال الرائي، فلا تجعل الجواب قطعيًا أو مخيفًا.

تعليمات خاصة بالرموز الحديثة واللهجة:
- إذا وجد رمز حديث مثل الرصاص/إطلاق النار/السيارة/الهاتف، فقارنه بأقرب رمز قديم فقط عند وجود دعم من الاسترجاع أو من خريطة الرموز.
- في هذا المشروع: الرصاص وإطلاق النار يقاسان على السهم، الرمي، السلاح، الجرح، الطعن، القتل.
- الإصابة في الظهر تقاس على الظهر، الخلف، الدبر، وراء الشخص، أو الأذى غير المباشر.
- إذا ظهرت كلمة طلق/طلقتين في سياق الرصاص فلا تفسرها كطلاق زوجي.
- إذا رجعت مقتطفات عن معدن الرصاص أو صنم الرصاص، فاعتبرها غير منطبقة على الرصاصة إلا إذا كان السياق واضحًا.

خريطة التوسيع التي استخدمها نظام البحث:
${JSON.stringify({
  canonicalDream: expansion.canonicalDream,
  triggeredRules: expansion.triggeredRules,
  queryVariants: expansion.queryVariants,
  focusTerms: expansion.focusTerms,
  ambiguityWarnings: expansion.ambiguityWarnings
}, null, 2)}

حلم المستخدم:
${dream}

المقتطفات المسترجعة بعد التوسيع وإعادة الترتيب:
${JSON.stringify(context, null, 2)}

أخرج JSON صالحا فقط بدون markdown بهذا الشكل:
{
  "answer": "جواب عربي واضح ومختصر، يفرق بين النص المباشر والقياس الرمزي، ويستخدم ضمائر صحيحة حسب dreamContext",
  "dreamContextSummary": "ملخص من هو الرائي ومن هو الشخص المرئي وما أثر ذلك على التفسير",
  "askedQuestionsUsed": ["إجابة توضيحية مؤثرة استخدمتها في التفسير"],
  "reasoningSummary": "ملخص استدلال قابل للمراجعة في 2-4 جمل، وليس سلسلة تفكير داخلية",
  "symbolAnalysis": ["تحليل رمز مختصر", "تحليل رمز آخر"],
  "sourceBasedPoints": ["نقطة مستندة إلى مصدر أو قياس مصرح به", "نقطة أخرى"],
  "citations": [
    {
      "sourceTitle": "اسم المصدر",
      "author": "المؤلف",
      "location": "الموضع",
      "usedFor": "هل استُخدم كنص مباشر أم قياس قريب أم تم استبعاده؟"
    }
  ],
  "uncertainty": ["حدود أو احتمالات غير محسومة"],
  "followUpQuestions": ["سؤال مهم للرائي إن كان يلزم"],
  "evidenceQuality": "قوي/متوسط/ضعيف مع سبب مختصر",
  "selfEvaluation": {
    "retrievalCoverage": 0,
    "citationGrounding": 0,
    "answerCaution": 0,
    "notes": "ملاحظات تقييم قصيرة"
  }
}

قواعد الدرجات من 0 إلى 100:
- retrievalCoverage: كم رمزًا مركزيًا غطّاه البحث؟
- citationGrounding: هل المقتطفات مرتبطة فعلاً بالحلم؟ لا ترفعها إذا كانت عن معدن الرصاص أو الطلاق الزوجي أو سياق بعيد.
- answerCaution: هل الجواب حذر ويفصل بين المباشر والقياس؟
`.trim();
}

function parseJsonLoose(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Fall through to the richer diagnostic below.
      }
    }
    const error = new Error("INVALID_JSON_RESPONSE");
    error.name = "GeminiJsonParseError";
    Object.assign(error, {
      rawPreview: text.slice(0, 1200),
      rawLength: text.length
    });
    throw error;
  }
}

let nextGeminiAllowedAt = 0;

function estimateTokens(input: string) {
  return Math.ceil(input.length / 4);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFromText(text: string) {
  const match = text.match(/retry in\s+([\d.]+)s/i) || text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (!match) return null;
  return Math.ceil(Number(match[1]) * 1000);
}

function parseGeminiError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  let providerError: Record<string, unknown> | null = null;

  try {
    const parsed = JSON.parse(rawMessage) as { error?: Record<string, unknown> };
    providerError = parsed.error ?? null;
  } catch {
    providerError = null;
  }

  const details = Array.isArray(providerError?.details) ? (providerError.details as Array<Record<string, unknown>>) : [];
  const retryInfo = details.find((item) => String(item["@type"] ?? "").includes("RetryInfo"));
  const retryDelay = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay : null;
  const retryDelayMs = retryDelay ? retryDelayFromText(`retry in ${retryDelay}`) : retryDelayFromText(rawMessage);
  const status = Number(providerError?.code ?? (error && typeof error === "object" ? (error as Record<string, unknown>).status : null));
  const rawCode = providerError?.status ?? (error && typeof error === "object" ? (error as Record<string, unknown>).code : null);
  const code = typeof rawCode === "string" || typeof rawCode === "number" ? rawCode : null;

  return {
    message: String(providerError?.message ?? rawMessage),
    status: Number.isFinite(status) ? status : null,
    code,
    retryDelayMs
  };
}

async function waitForGeminiSlot() {
  const minIntervalMs = Math.max(0, Number(process.env.GEMINI_MIN_REQUEST_INTERVAL_MS || 12000));
  const now = Date.now();
  const waitMs = Math.max(0, nextGeminiAllowedAt - now);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextGeminiAllowedAt = Date.now() + minIntervalMs;
  return waitMs;
}

export async function interpretWithGemini(dream: string, search: RagSearchResult, workflowContext?: InterpretationWorkflowContext): Promise<GeminiInterpretation> {
  const apiKey = getApiKey();
  const models = pickModels();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(dream, search, workflowContext);
  const thinkingBudget = Number(process.env.GEMINI_COMPOSE_THINKING_BUDGET || 0);
  const maxOutputTokens = Number(process.env.GEMINI_COMPOSE_MAX_OUTPUT_TOKENS || 2200);
  const maxRetries = Math.max(0, Number(process.env.GEMINI_MAX_RETRIES || 1));
  const retryBaseDelayMs = Math.max(250, Number(process.env.GEMINI_RETRY_BASE_DELAY_MS || 1500));
  const promptTokenEstimate = estimateTokens(prompt);
  const attempts: GeminiAttempt[] = [];

  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    const hasNextModel = modelIndex < models.length - 1;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const started = Date.now();
      const throttleWaitMs = await waitForGeminiSlot();

      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.12,
            maxOutputTokens,
            responseMimeType: "application/json",
            ...(thinkingBudget > 0 ? { thinkingConfig: { thinkingBudget } } : {})
          }
        });

        attempts.push({
          model,
          attempt,
          durationMs: Date.now() - started,
          promptTokenEstimate,
          throttleWaitMs,
          success: true
        });

        let thoughtSummary = "";
        let answerText = "";
        const parts = response.candidates?.[0]?.content?.parts ?? [];

        for (const part of parts) {
          if (!part.text) continue;
          if (part.thought) {
            thoughtSummary += part.text;
          } else {
            answerText += part.text;
          }
        }

        const rawText = answerText || response.text || "";
        const parsed = parseJsonLoose(rawText);

        return {
          answer: String(parsed.answer ?? ""),
          dreamContextSummary: typeof parsed.dreamContextSummary === "string" ? parsed.dreamContextSummary : undefined,
          askedQuestionsUsed: Array.isArray(parsed.askedQuestionsUsed) ? parsed.askedQuestionsUsed.map(String) : [],
          reasoningSummary: String(parsed.reasoningSummary ?? ""),
          sourceBasedPoints: Array.isArray(parsed.sourceBasedPoints) ? parsed.sourceBasedPoints.map(String) : [],
          citations: Array.isArray(parsed.citations) ? parsed.citations : [],
          uncertainty: Array.isArray(parsed.uncertainty) ? parsed.uncertainty.map(String) : [],
          followUpQuestions: Array.isArray(parsed.followUpQuestions) ? parsed.followUpQuestions.map(String) : [],
          symbolAnalysis: Array.isArray(parsed.symbolAnalysis) ? parsed.symbolAnalysis.map(String) : [],
          evidenceQuality: typeof parsed.evidenceQuality === "string" ? parsed.evidenceQuality : undefined,
          selfEvaluation: {
            retrievalCoverage: Number(parsed.selfEvaluation?.retrievalCoverage ?? 0),
            citationGrounding: Number(parsed.selfEvaluation?.citationGrounding ?? 0),
            answerCaution: Number(parsed.selfEvaluation?.answerCaution ?? 0),
            notes: String(parsed.selfEvaluation?.notes ?? "")
          },
          rawText,
          thoughtSummary: thoughtSummary.trim(),
          model,
          attempts
        };
      } catch (error) {
        lastError = error;
        const parsedError = parseGeminiError(error);
        attempts.push({
          model,
          attempt,
          durationMs: Date.now() - started,
          promptTokenEstimate,
          throttleWaitMs,
          success: false,
          error: parsedError.message,
          status: parsedError.status,
          code: parsedError.code,
          retryDelayMs: parsedError.retryDelayMs
        });

        const isRetryable =
          parsedError.status === 429 ||
          parsedError.status === 503 ||
          parsedError.code === "RESOURCE_EXHAUSTED" ||
          parsedError.code === "UNAVAILABLE";
        const isQuotaLimit = parsedError.status === 429 || parsedError.code === "RESOURCE_EXHAUSTED";

        if (isQuotaLimit && hasNextModel) {
          break;
        }

        if (!isRetryable || attempt >= maxRetries) {
          break;
        }

        const delayMs = Math.min(30000, parsedError.retryDelayMs ?? retryBaseDelayMs * 2 ** attempt);
        await sleep(delayMs);
      }
    }
  }

  if (lastError && typeof lastError === "object") {
    Object.assign(lastError, { attempts });
  }
  throw lastError ?? new Error("GEMINI_FAILED_WITHOUT_ERROR");
}
