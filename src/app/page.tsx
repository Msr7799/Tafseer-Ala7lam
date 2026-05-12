"use client";

import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  FileQuestion,
  FileText,
  Gauge,
  LogIn,
  LogOut,
  Loader2,
  Menu,
  Play,
  Radar,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User as FirebaseUser } from "firebase/auth";
import { limitToLast, onValue, orderByChild, push, query, ref, serverTimestamp, set, update } from "firebase/database";
import { firebaseAuth, firebaseDatabase, googleProvider } from "@/lib/firebase";

type DreamContextPayload = {
  narratorLabel: string;
  dreamerRole: string;
  dreamerLabel: string;
  subjectRole: string;
  subjectLabel: string;
  relationship?: string;
  isReportedDream: boolean;
  confidence: number;
  facts: string[];
  grammarGuidance: string[];
  searchHints: string[];
  warnings: string[];
};

type ClarifyingQuestionPayload = {
  id: string;
  question: string;
  why: string;
  appliesTo: "dreamer" | "subject" | "both" | "dream";
  priority: number;
  inputType: "text" | "select";
  choices?: string[];
  optional?: boolean;
};

type NodeTracePayload = {
  id: string;
  label: string;
  status: "done" | "waiting" | "skipped" | "error";
  durationMs: number;
  summary: string;
};

type WorkflowPayload = {
  dreamContext: DreamContextPayload;
  questions: ClarifyingQuestionPayload[];
  answeredQuestions: Array<{ id: string; question: string; answer: string }>;
  nodeTrace: NodeTracePayload[];
  recommendation: string;
  clarificationPlan?: {
    needsClarification: boolean;
    contextQuality: string;
    canAnswerWithoutQuestions: boolean;
    missingContext: string[];
    note: string;
  };
};

type ExpansionDebug = {
  original: string;
  dreamContext?: {
    dreamerLabel: string;
    subjectLabel: string;
    isReportedDream: boolean;
    confidence: number;
  };
  normalizedOriginal: string;
  canonicalDream: string;
  expandedQuery: string;
  queryVariants: string[];
  expandedTerms: string[];
  focusTerms: string[];
  negativeTerms: string[];
  triggeredRules: Array<{
    id: string;
    label: string;
    reason: string;
  }>;
  symbolHints: string[];
  ambiguityWarnings: string[];
  termWeights: Record<string, number>;
};

type RetrievalPayload = {
  hits: Array<{
    rank: number;
    score: number;
    lexicalScore: number;
    sourceScore: number;
    semanticScore: number;
    coverageScore: number;
    falseFriendPenalty: number;
    phraseBonus: number;
    matchedTerms: string[];
    matchedFocusTerms: string[];
    rerankReason: string;
    sourceTitle: string;
    author: string;
    role: string;
    roleLabel: string;
    location: {
      label: string;
    };
    sourcePath: string;
    excerpt: string;
    qualityScore: number;
  }>;
  debug: {
    normalizedQuery: string;
    expandedQuery: string;
    queryTerms: string[];
    expansion: ExpansionDebug;
    totalChunks: number;
    candidatesWithScore: number;
    selectedSources: Record<string, number>;
    timingsMs: {
      loadIndex: number;
      expansion: number;
      scoring: number;
      total: number;
    };
  };
  index: {
    builtAt: string;
    totalChunks: number;
    sources: Array<{
      id: string;
      title: string;
      author: string;
      role: string;
      chunks: number;
      units: number;
    }>;
  };
};

type ApiResponse = {
  ok: boolean;
  needsFollowUp?: boolean;
  requestId?: string;
  error?: string;
  message?: string;
  dream?: string;
  totalMs?: number;
  workflow?: WorkflowPayload | null;
  debug?: {
    requestId?: string;
    stage?: string;
    topK?: number;
    dreamLength?: number;
    totalMs?: number;
    retrievalAvailable?: boolean;
    retrievalDebug?: {
      normalizedQuery: string;
      expandedQuery?: string;
      queryTerms: string[];
      expansion?: ExpansionDebug;
      totalChunks: number;
      candidatesWithScore: number;
      selectedSources: Record<string, number>;
      timingsMs: {
        loadIndex: number;
        expansion?: number;
        scoring: number;
        total: number;
      };
    } | null;
    error?: {
      name?: string;
      message?: string;
      status?: string | number | null;
      code?: string | number | null;
      provider?: unknown;
      attempts?: unknown[] | null;
      rawPreview?: string | null;
      rawLength?: number | null;
      stack?: string[] | null;
    };
  };
  interpretation?: {
    answer: string;
    dreamContextSummary?: string;
    askedQuestionsUsed?: string[];
    reasoningSummary: string;
    symbolAnalysis?: string[];
    sourceBasedPoints: string[];
    citations: Array<{
      sourceTitle: string;
      author: string;
      location: string;
      usedFor: string;
    }>;
    uncertainty: string[];
    followUpQuestions: string[];
    evidenceQuality?: string;
    selfEvaluation: {
      retrievalCoverage: number;
      citationGrounding: number;
      answerCaution: number;
      notes: string;
    };
    model: string;
    attempts?: unknown[];
  };
  retrieval?: RetrievalPayload;
  partialRetrieval?: RetrievalPayload | null;
};

const sampleDream = "أكتب حلمك أو الحلم الذي تريد تفسيره هنا. حاول أن تذكر تفاصيل عن الرائي، الأشخاص المرئيين، المشاعر، والأحداث. إذا كان الحلم منقولا حاول أن تذكر من روى الحلم ومن هو الرائي الحقيقي إذا كنت تعرفه. كلما زادت التفاصيل، كان التفسير أدق!";

const pipelineSteps = [
  "Node 1: فهم الرائي والشخص المرئي",
  "Node 2: قرار الأسئلة التوضيحية",
  "Node 3: توسيع الرموز الحديثة",
  "Node 4: استرجاع المقاطع وإعادة ترتيبها",
  "Node 5: توليد جواب حذر بالمصادر"
];

const storageKey = "dream-rag:last-result:v3";

type ActiveTab = "answer" | "sources" | "analysis" | "debug";

type DreamHistoryItem = {
  id: string;
  title: string;
  dream: string;
  topK: number;
  contextAnswers: Record<string, string>;
  result: ApiResponse;
  answerPreview: string;
  createdAt: number;
  updatedAt?: number;
};

export default function Home() {
  const [dream, setDream] = useState("");
  const [topK, setTopK] = useState(10);
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>("answer");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [contextAnswers, setContextAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [history, setHistory] = useState<DreamHistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const interpretation = result?.interpretation;
  const retrieval = result?.retrieval;
  const activeRetrieval = result?.retrieval ?? result?.partialRetrieval ?? null;
  const workflow = result?.workflow ?? null;
  const evaluation = interpretation?.selfEvaluation;
  const hasResult = Boolean(result?.ok && interpretation && retrieval);
  const typedAnswer = useTypewriter(interpretation?.answer ?? "", hasResult && !loading, 8);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (!currentUser) {
        setHistory([]);
        setActiveHistoryId(null);
        return;
      }

      await update(ref(firebaseDatabase, `users/${currentUser.uid}/profile`), {
        uid: currentUser.uid,
        name: currentUser.displayName ?? "",
        email: currentUser.email ?? "",
        photoURL: currentUser.photoURL ?? "",
        provider: "google",
        lastLoginAt: serverTimestamp()
      });
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const historyQuery = query(ref(firebaseDatabase, `users/${user.uid}/dreams`), orderByChild("createdAt"), limitToLast(40));
    return onValue(historyQuery, (snapshot) => {
      const value = snapshot.val() as Record<string, Omit<DreamHistoryItem, "id">> | null;
      const items = Object.entries(value ?? {})
        .map(([id, item]) => ({ ...item, id }))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setHistory(items);
    });
  }, [user]);

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(storageKey);
      if (!cached) return;
      const parsed = JSON.parse(cached) as { dream?: string; topK?: number; result?: ApiResponse; contextAnswers?: Record<string, string> };
      if (parsed.dream) setDream(parsed.dream);
      if (typeof parsed.topK === "number") setTopK(parsed.topK);
      if (parsed.result) setResult(parsed.result);
      if (parsed.contextAnswers) setContextAnswers(parsed.contextAnswers);
    } catch {
      // Ignore cache corruption.
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ dream, topK, result, contextAnswers }));
    } catch {
      // Storage can fail in private windows; the app should still work.
    }
  }, [contextAnswers, dream, result, topK]);

  useEffect(() => {
    if (!loading) return;
    setStageIndex(0);
    const timer = window.setInterval(() => {
      setStageIndex((current) => Math.min(pipelineSteps.length - 1, current + 1));
    }, 1100);
    return () => window.clearInterval(timer);
  }, [loading]);

  async function submitDream(options: { forceInterpret?: boolean } = {}) {
    const signedInUser = user ?? firebaseAuth.currentUser ?? await signInWithGoogle();
    if (!signedInUser) return;

    setLoading(true);
    setError("");
    setActiveTab("answer");
    if (!options.forceInterpret) setResult(null);

    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dream,
          topK,
          contextAnswers,
          forceInterpret: Boolean(options.forceInterpret)
        })
      });
      const text = await response.text();
      let data: ApiResponse;

      try {
        data = JSON.parse(text) as ApiResponse;
      } catch {
        data = {
          ok: false,
          error: "CLIENT_NON_JSON_RESPONSE",
          message: "السيرفر رجع رد غير JSON.",
          totalMs: 0,
          debug: {
            stage: "client_parse_response",
            error: {
              name: "ClientParseError",
              message: `HTTP ${response.status}`,
              status: response.status,
              rawPreview: text.slice(0, 1200),
              rawLength: text.length
            }
          }
        };
      }

      if (!response.ok && data.ok !== false) {
        data.ok = false;
        data.error = data.error || `HTTP_${response.status}`;
      }

      setResult(data);
      if (data.ok && data.interpretation && data.retrieval) {
        await saveDreamHistory(signedInUser.uid, data);
      }
      if (data.needsFollowUp) setActiveTab("answer");
      if (!data.ok) setError(data.message || data.error || "تعذر تنفيذ الطلب.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الاتصال بالسيرفر.");
    } finally {
      setLoading(false);
    }
  }

  function clearCache() {
    window.localStorage.removeItem(storageKey);
    setResult(null);
    setContextAnswers({});
    setError("");
  }

  function updateAnswer(id: string, value: string) {
    setContextAnswers((current) => ({ ...current, [id]: value }));
  }

  async function signInWithGoogle() {
    setAuthLoading(true);
    setError("");
    try {
      const credential = await signInWithPopup(firebaseAuth, googleProvider);
      return credential.user;
    } catch (err) {
      const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
      if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request" || code === "auth/popup-closed-by-user") {
        await signInWithRedirect(firebaseAuth, googleProvider);
        return null;
      }
      setError(err instanceof Error ? err.message : "تعذر تسجيل الدخول عبر Google.");
      return null;
    } finally {
      setAuthLoading(false);
    }
  }

  async function saveDreamHistory(uid: string, data: ApiResponse) {
    const now = Date.now();
    const itemRef = push(ref(firebaseDatabase, `users/${uid}/dreams`));
    await set(itemRef, {
      title: createHistoryTitle(dream),
      dream,
      topK,
      contextAnswers,
      result: data,
      answerPreview: data.interpretation?.answer?.slice(0, 220) ?? "",
      createdAt: now,
      updatedAt: now
    } satisfies Omit<DreamHistoryItem, "id">);
    setActiveHistoryId(itemRef.key);
  }

  function selectHistoryItem(item: DreamHistoryItem) {
    setDream(item.dream);
    setTopK(item.topK);
    setContextAnswers(item.contextAnswers ?? {});
    setResult(item.result);
    setError("");
    setActiveTab("answer");
    setActiveHistoryId(item.id);
  }

  const sources = useMemo(() => {
    if (!activeRetrieval?.index.sources) return [];
    return activeRetrieval.index.sources.filter((source) => source.chunks > 0);
  }, [activeRetrieval]);

  return (
    <main className="app-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <AppNavbar
        user={user}
        authReady={authReady}
        authLoading={authLoading}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onSignIn={signInWithGoogle}
        onSignOut={() => signOut(firebaseAuth)}
      />

      <header className="hero">
        <div className="hero-copy reveal-card">
          <div className="brand-pill">
            <Sparkles size={16} />
            RAG تفسير الأحلام · Nodes Workflow · Gemini
          </div>
          <h1>مفسّر أحلام يسأل عندما يحتاج السياق، ثم يفسّر بالمصادر</h1>
          <p>
            النظام الآن يعمل كمسار نودز: يفهم من هو الرائي، يقرر هل يحتاج أسئلة، يوسّع الرموز الحديثة، يسترجع المقاطع، ثم يصوغ جوابًا حذرًا بضمائر صحيحة ومصادر قابلة للمراجعة.
          </p>
          <div className="hero-actions">
            <button onClick={() => submitDream()} disabled={loading} className="primary-button glow-button">
              {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {loading ? "جاري تشغيل النودز..." : "شغّل التحليل"}
            </button>
            <button onClick={clearCache} className="ghost-button" type="button">
              <RefreshCcw size={17} />
              مسح آخر نتيجة
            </button>
          </div>
        </div>

        <div className="hero-metrics reveal-card delay-1">
          <Metric icon={<Database size={18} />} label="الفهرس" value={activeRetrieval?.debug.totalChunks ? `${activeRetrieval.debug.totalChunks} قطعة` : "محلي"} />
          <Metric icon={<FileQuestion size={18} />} label="الأسئلة" value={workflow?.questions?.length ? `${workflow.questions.length} مطلوبة` : "ذكية"} />
          <Metric icon={<ShieldCheck size={18} />} label="الضمائر" value={workflow?.dreamContext?.isReportedDream ? "رؤيا منقولة" : "مباشرة"} />
        </div>
      </header>

      <section className={sidebarOpen ? "workspace" : "workspace sidebar-collapsed"}>
        <aside className="control-column">
          <UserSidebar
            user={user}
            authReady={authReady}
            authLoading={authLoading}
            history={history}
            activeHistoryId={activeHistoryId}
            onSignIn={signInWithGoogle}
            onSignOut={() => signOut(firebaseAuth)}
            onSelectHistory={selectHistoryItem}
          />

          <Panel title="نص الحلم" icon={<Brain size={19} />} className="sticky-panel">
            <textarea value={dream} onChange={(event) => setDream(event.target.value)} placeholder={sampleDream} rows={10} className="dream-input" />
            <div className="input-footer">
              <span>{dream.trim().length} حرف</span>
              <span>{topK} مقاطع</span>
            </div>

            <div className="range-card">
              <label>عدد المقاطع المسترجعة</label>
              <input value={topK} min={4} max={16} type="range" onChange={(event) => setTopK(Number(event.target.value))} />
              <div className="range-scale"><span>دقيق</span><span>أوسع</span></div>
            </div>

            <button onClick={() => submitDream()} disabled={loading} className="primary-button full-width">
              {loading ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
              {loading ? pipelineSteps[stageIndex] : "فسّر الحلم بالمصادر"}
            </button>
          </Panel>

          {workflow?.dreamContext ? <ContextMiniCard context={workflow.dreamContext} /> : null}
          {workflow?.nodeTrace?.length ? <NodeTracePanel nodes={workflow.nodeTrace} /> : null}
          {loading ? <PipelineCard stageIndex={stageIndex} /> : null}
          {error ? <ErrorDiagnostic error={error} result={result} /> : null}

          <Panel title="مصادر الفهرس" icon={<BookOpen size={18} />}>
            <div className="source-list">
              {sources.length ? (
                sources.map((source, index) => (
                  <div key={source.id} className="source-row" style={{ animationDelay: `${index * 45}ms` }}>
                    <span>{source.title}</span>
                    <strong>{source.chunks}</strong>
                  </div>
                ))
              ) : (
                <p className="muted-text">بعد أول طلب ستظهر هنا إحصاءات الفهرس. إذا ظهر خطأ الفهرس، شغّل pnpm rag:build.</p>
              )}
            </div>
          </Panel>
        </aside>

        <section className="result-column">
          {loading ? <LoadingNarrative stageIndex={stageIndex} /> : null}

          {!loading && result?.needsFollowUp && workflow ? (
            <FollowUpPanel
              workflow={workflow}
              answers={contextAnswers}
              onAnswer={updateAnswer}
              onContinue={() => submitDream({ forceInterpret: true })}
              loading={loading}
            />
          ) : null}

          {!loading && !hasResult && !activeRetrieval && !result?.needsFollowUp ? <EmptyState /> : null}
          {!loading && !hasResult && activeRetrieval ? <PartialRetrievalPanel retrieval={activeRetrieval} /> : null}

          {hasResult && interpretation && retrieval ? (
            <div className="result-stack">
              <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

              {activeTab === "answer" ? (
                <>
                  <Panel title="جواب النموذج" icon={<Sparkles size={19} />} badge={interpretation.model} className="answer-panel reveal-card">
                    <p className="answer-text">
                      {typedAnswer}
                      {typedAnswer.length < interpretation.answer.length ? <span className="typing-cursor">▌</span> : null}
                    </p>
                    {interpretation.evidenceQuality ? <div className="evidence-chip">جودة الاستدلال: {interpretation.evidenceQuality}</div> : null}
                  </Panel>

                  {workflow?.dreamContext ? <ContextUnderstandingCard context={workflow.dreamContext} summary={interpretation.dreamContextSummary} answersUsed={interpretation.askedQuestionsUsed ?? []} /> : null}

                  <div className="score-grid reveal-card delay-1">
                    <ScoreCard label="تغطية الرموز" value={evaluation?.retrievalCoverage ?? 0} hint="كم رمزًا مركزيًا وجد له النظام سندًا أو قياسًا قريبًا؟" />
                    <ScoreCard label="صلة المصادر" value={evaluation?.citationGrounding ?? 0} hint="هل المقاطع فعلاً مرتبطة بالحلم؟" />
                    <ScoreCard label="حذر التأويل" value={evaluation?.answerCaution ?? 0} hint="هل فرّق بين النص والقياس والاحتمال؟" />
                  </div>

                  <div className="two-column reveal-card delay-2">
                    <Panel title="ملخص الاستدلال" icon={<FileText size={18} />}>
                      <p className="rich-text">{interpretation.reasoningSummary}</p>
                      {evaluation?.notes ? <p className="note-box">{evaluation.notes}</p> : null}
                    </Panel>
                    <Panel title="حدود الجواب" icon={<ShieldCheck size={18} />}>
                      <List values={interpretation.uncertainty} fallback="لا توجد حدود مذكورة من الموديل." />
                    </Panel>
                  </div>
                </>
              ) : null}

              {activeTab === "analysis" ? (
                <>
                  <div className="two-column reveal-card">
                    <Panel title="تحليل الرموز" icon={<Radar size={18} />}>
                      <List values={interpretation.symbolAnalysis ?? []} fallback="لم يرجع الموديل تحليل رموز مستقل." />
                    </Panel>
                    <Panel title="النقاط المستندة للمصادر" icon={<CheckCircle2 size={18} />}>
                      <List values={interpretation.sourceBasedPoints} fallback="لم يرجع الموديل نقاطًا مستقلة." />
                    </Panel>
                  </div>
                  {workflow?.nodeTrace?.length ? <NodeTracePanel nodes={workflow.nodeTrace} expanded /> : null}
                </>
              ) : null}

              {activeTab === "sources" ? (
                <>
                  <Panel title="المصادر المستخدمة" icon={<BookOpen size={18} />} className="reveal-card">
                    <div className="citation-grid">
                      {interpretation.citations.length ? (
                        interpretation.citations.map((citation, index) => (
                          <article className="citation-card" key={`${citation.sourceTitle}-${index}`}>
                            <strong>{citation.sourceTitle}</strong>
                            <span>{citation.author}</span>
                            <small>{citation.location}</small>
                            <p>{citation.usedFor}</p>
                          </article>
                        ))
                      ) : (
                        <p className="muted-text">لم يرجع الموديل مصادر مستخدمة.</p>
                      )}
                    </div>
                  </Panel>
                  <HitsPanel retrieval={retrieval} />
                </>
              ) : null}

              {activeTab === "debug" ? <DebugPanel retrieval={retrieval} workflow={workflow} /> : null}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function useTypewriter(text: string, enabled: boolean, speedMs: number) {
  const [visible, setVisible] = useState("");

  useEffect(() => {
    if (!enabled || !text) {
      setVisible(enabled ? text : "");
      return;
    }

    setVisible("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, speedMs);

    return () => window.clearInterval(timer);
  }, [enabled, speedMs, text]);

  return visible;
}

function createHistoryTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "حلم بدون عنوان";
  return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized;
}

function formatHistoryDate(value: number) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AppNavbar({
  user,
  authReady,
  authLoading,
  sidebarOpen,
  onToggleSidebar,
  onSignIn,
  onSignOut
}: {
  user: FirebaseUser | null;
  authReady: boolean;
  authLoading: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSignIn: () => Promise<FirebaseUser | null>;
  onSignOut: () => Promise<void>;
}) {
  return (
    <nav className="top-navbar">
      <div className="nav-brand">
        <button type="button" className="icon-button" onClick={onToggleSidebar} aria-label={sidebarOpen ? "إغلاق السايدبار" : "فتح السايدبار"}>
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div>
          <strong>تفسير الأحلام</strong>
          <span>RAG + Firebase</span>
        </div>
      </div>

      <div className="nav-auth">
        {user ? (
          <>
            <div className="nav-user">
              {user.photoURL ? <img src={user.photoURL} alt={user.displayName ?? "Google user"} /> : <span><UserRound size={18} /></span>}
              <strong>{user.displayName ?? "مستخدم Google"}</strong>
            </div>
            <button type="button" className="ghost-button nav-logout" onClick={onSignOut}>
              <LogOut size={17} />
              تسجيل الخروج
            </button>
          </>
        ) : (
          <button type="button" className="google-login-button" disabled={!authReady || authLoading} onClick={onSignIn} aria-label="Sign in with Google">
            {authLoading ? <Loader2 className="spin" size={18} /> : <img src="/google-login-dark.svg" alt="Sign in with Google" />}
          </button>
        )}
      </div>
    </nav>
  );
}

function UserSidebar({
  user,
  authReady,
  authLoading,
  history,
  activeHistoryId,
  onSignIn,
  onSignOut,
  onSelectHistory
}: {
  user: FirebaseUser | null;
  authReady: boolean;
  authLoading: boolean;
  history: DreamHistoryItem[];
  activeHistoryId: string | null;
  onSignIn: () => Promise<FirebaseUser | null>;
  onSignOut: () => Promise<void>;
  onSelectHistory: (item: DreamHistoryItem) => void;
}) {
  return (
    <Panel title="حساب المستخدم" icon={<UserRound size={18} />} className="user-panel">
      {user ? (
        <>
          <div className="user-card">
            {user.photoURL ? <img src={user.photoURL} alt={user.displayName ?? "Google user"} /> : <span className="avatar-fallback"><UserRound size={22} /></span>}
            <div>
              <strong>{user.displayName ?? "مستخدم Google"}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <button type="button" className="ghost-button full-width compact-button" onClick={onSignOut}>
            <LogOut size={17} />
            تسجيل الخروج
          </button>
        </>
      ) : (
        <>
          <p className="muted-text">سجل الدخول بحساب Google حتى يتم حفظ بياناتك وصورة البروفايل وكل تفسيرات الأحلام في Firebase.</p>
          <button type="button" className="primary-button full-width compact-button" disabled={!authReady || authLoading} onClick={onSignIn}>
            {authLoading ? <Loader2 className="spin" size={18} /> : <LogIn size={18} />}
            {authLoading ? "جاري تسجيل الدخول..." : "تسجيل الدخول بـ Google"}
          </button>
        </>
      )}

      <div className="history-block">
        <div className="history-title">
          <strong>هيستوري الأحلام</strong>
          <span>{history.length}</span>
        </div>
        {user ? (
          <div className="history-list">
            {history.length ? history.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === activeHistoryId ? "history-item active" : "history-item"}
                onClick={() => onSelectHistory(item)}
              >
                <strong>{item.title}</strong>
                <span>{formatHistoryDate(item.createdAt)}</span>
                <small>{item.answerPreview || item.dream}</small>
              </button>
            )) : <p className="muted-text">بعد أول تفسير سيظهر هنا سجل أحلامك ويمكنك فتح أي نتيجة بضغطة.</p>}
          </div>
        ) : (
          <p className="muted-text">الهستوري يظهر بعد تسجيل الدخول.</p>
        )}
      </div>
    </Panel>
  );
}

function Panel({ title, icon, badge, children, className = "" }: { title: string; icon?: ReactNode; badge?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-title">
        <span className="title-icon">{icon}</span>
        <h2>{title}</h2>
        {badge ? <span className="pill">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}

function TabBar({ activeTab, setActiveTab }: { activeTab: ActiveTab; setActiveTab: (tab: ActiveTab) => void }) {
  const tabs: Array<{ id: ActiveTab; label: string; icon: ReactNode }> = [
    { id: "answer", label: "الجواب", icon: <Sparkles size={16} /> },
    { id: "analysis", label: "التحليل", icon: <Radar size={16} /> },
    { id: "sources", label: "المصادر", icon: <BookOpen size={16} /> },
    { id: "debug", label: "ديباق المطور", icon: <Activity size={16} /> }
  ];

  return (
    <div className="tab-bar reveal-card">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={activeTab === tab.id ? "active" : ""}>
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ScoreCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="score-card">
      <div className="score-top">
        <span>{label}</span>
        <Gauge size={18} />
      </div>
      <div className="score-number"><strong>{Math.round(clamped)}</strong><span>/100</span></div>
      <div className="score-bar"><div style={{ width: `${clamped}%` }} /></div>
      <p>{hint}</p>
    </div>
  );
}

function PipelineCard({ stageIndex }: { stageIndex: number }) {
  return (
    <Panel title="مسار التحليل الآن" icon={<Activity size={18} />} className="pipeline-card">
      <ol className="pipeline-list">
        {pipelineSteps.map((step, index) => (
          <li key={step} className={index <= stageIndex ? "active" : ""}>
            <span>{index < stageIndex ? <CheckCircle2 size={14} /> : index === stageIndex ? <Loader2 className="spin" size={14} /> : index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function LoadingNarrative({ stageIndex }: { stageIndex: number }) {
  return (
    <div className="loading-stage">
      <div className="orb-loader"><span /><span /><span /></div>
      <h2>{pipelineSteps[stageIndex]}</h2>
      <p>الواجهة تعرض تقدم النودز، ثم تظهر النتيجة بالتدريج بعد رجوع API.</p>
      <div className="skeleton-lines"><span /><span /><span /></div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state reveal-card">
      <Search size={36} />
      <h2>جاهز للتجربة</h2>
      <p>اكتب الحلم واضغط تفسير. إذا احتاج النظام عمرًا أو حالة اجتماعية أو سياقًا واقعيًا سيطرح أسئلة قصيرة قبل التفسير.</p>
    </div>
  );
}

function FollowUpPanel({ workflow, answers, onAnswer, onContinue, loading }: { workflow: WorkflowPayload; answers: Record<string, string>; onAnswer: (id: string, value: string) => void; onContinue: () => void; loading: boolean }) {
  return (
    <Panel title="أسئلة توضيحية قبل التفسير الأدق" icon={<FileQuestion size={19} />} className="follow-up-panel reveal-card">
      <p className="rich-text">{workflow.recommendation}</p>
      <ContextUnderstandingCard context={workflow.dreamContext} />
      <div className="question-list">
        {workflow.questions.map((question, index) => (
          <article className="question-card" key={question.id} style={{ animationDelay: `${index * 70}ms` }}>
            <div>
              <strong>{question.question}</strong>
              <p>{question.why}</p>
            </div>
            {question.inputType === "select" && question.choices?.length ? (
              <div className="choice-row">
                {question.choices.map((choice) => (
                  <button key={choice} type="button" className={answers[question.id] === choice ? "active" : ""} onClick={() => onAnswer(question.id, choice)}>{choice}</button>
                ))}
              </div>
            ) : (
              <textarea className="answer-input" value={answers[question.id] ?? ""} onChange={(event) => onAnswer(question.id, event.target.value)} placeholder="اكتب جوابًا قصيرًا..." rows={3} />
            )}
          </article>
        ))}
      </div>
      <div className="hero-actions">
        <button type="button" className="primary-button" onClick={onContinue} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
          أكمل التفسير بهذه الإجابات
        </button>
        <button type="button" className="ghost-button" onClick={onContinue} disabled={loading}>تخطَّ الأسئلة وفسّر بحذر</button>
      </div>
    </Panel>
  );
}

function ContextMiniCard({ context }: { context: DreamContextPayload }) {
  return (
    <Panel title="فهم النظام للحلم" icon={<Brain size={18} />}>
      <div className="context-mini">
        <span>الرائي</span><strong>{context.dreamerLabel}</strong>
        <span>الشخص المرئي</span><strong>{context.subjectLabel}</strong>
        <span>نوع الرؤيا</span><strong>{context.isReportedDream ? "منقولة" : "مباشرة"}</strong>
      </div>
    </Panel>
  );
}

function ContextUnderstandingCard({ context, summary, answersUsed = [] }: { context: DreamContextPayload; summary?: string; answersUsed?: string[] }) {
  return (
    <Panel title="فهم النظام للرؤيا" icon={<Brain size={18} />} className="reveal-card context-panel">
      <div className="context-grid">
        <ContextBox label="ناقل الرؤيا" value={context.narratorLabel} />
        <ContextBox label="الرائي الحقيقي" value={context.dreamerLabel} />
        <ContextBox label="الشخص المرئي" value={context.subjectLabel} />
        <ContextBox label="الثقة" value={`${Math.round(context.confidence * 100)}%`} />
      </div>
      {summary ? <p className="note-box">{summary}</p> : null}
      <List values={context.facts} fallback="لا توجد حقائق سياقية." />
      {answersUsed.length ? (
        <div className="chip-section">
          <strong>إجابات أثّرت على التفسير</strong>
          <div className="chip-cloud focus">{answersUsed.map((answer) => <span key={answer}>{answer}</span>)}</div>
        </div>
      ) : null}
    </Panel>
  );
}

function ContextBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="context-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NodeTracePanel({ nodes, expanded = false }: { nodes: NodeTracePayload[]; expanded?: boolean }) {
  return (
    <Panel title="نودز التحليل" icon={<Activity size={18} />} className={expanded ? "reveal-card" : ""}>
      <div className="node-list">
        {nodes.map((node) => (
          <div className={`node-card ${node.status}`} key={node.id}>
            <span>{node.status === "done" ? <CheckCircle2 size={15} /> : node.status === "waiting" ? <FileQuestion size={15} /> : <Clock3 size={15} />}</span>
            <div>
              <strong>{node.label}</strong>
              <p>{node.summary}</p>
              <small>{node.durationMs}ms</small>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PartialRetrievalPanel({ retrieval }: { retrieval: RetrievalPayload }) {
  return (
    <Panel title="البحث نجح لكن توليد الجواب فشل" icon={<Search size={18} />} className="reveal-card">
      <p className="rich-text">الفهرس والاسترجاع اشتغلا، والخطأ صار غالبًا في Gemini أو المفتاح أو الحصة. هذه أول النتائج بعد التوسيع الرمزي:</p>
      <div className="hits-list compact-hits">
        {retrieval.hits.slice(0, 5).map((hit) => <HitCard hit={hit} key={`partial-${hit.rank}-${hit.sourceTitle}`} />)}
      </div>
    </Panel>
  );
}

function DebugPanel({ retrieval, workflow }: { retrieval: RetrievalPayload; workflow: WorkflowPayload | null }) {
  const expansion = retrieval.debug.expansion;
  return (
    <Panel title="ديباق البحث والتوسيع الرمزي" icon={<Clock3 size={18} />} className="reveal-card">
      <div className="debug-grid">
        <DebugItem label="النص بعد التطبيع" value={retrieval.debug.normalizedQuery} />
        <DebugItem label="الاستعلام الموسّع" value={retrieval.debug.expandedQuery} />
        <DebugItem label="المرشحات" value={`${retrieval.debug.candidatesWithScore} من ${retrieval.debug.totalChunks}`} />
        <DebugItem label="زمن البحث" value={`${retrieval.debug.timingsMs.total}ms`} />
      </div>

      {workflow?.nodeTrace?.length ? <NodeTracePanel nodes={workflow.nodeTrace} expanded /> : null}

      <details className="details-card">
        <summary><ChevronDown size={16} /> قواعد التوسيع التي اشتغلت</summary>
        <div className="rule-list">
          {expansion.triggeredRules.length ? expansion.triggeredRules.map((rule) => (
            <article key={rule.id}>
              <strong>{rule.label}</strong>
              <p>{rule.reason}</p>
            </article>
          )) : <p className="muted-text">لم تعمل قواعد توسيع خاصة لهذا الحلم.</p>}
        </div>
      </details>

      {expansion.ambiguityWarnings.length ? (
        <div className="warning-list">
          {expansion.ambiguityWarnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}

      <div className="chip-section">
        <strong>استعلامات قريبة جرّبها النظام</strong>
        <div className="chip-cloud">{expansion.queryVariants.slice(0, 14).map((variant) => <span key={variant}>{variant}</span>)}</div>
      </div>

      <div className="chip-section">
        <strong>مصطلحات التركيز</strong>
        <div className="chip-cloud focus">{expansion.focusTerms.slice(0, 32).map((term) => <span key={term}>{term}</span>)}</div>
      </div>
    </Panel>
  );
}

function HitsPanel({ retrieval }: { retrieval: RetrievalPayload }) {
  return (
    <Panel title="المقاطع التي قرأها النظام" icon={<Database size={18} />} className="reveal-card">
      <div className="hits-list">
        {retrieval.hits.map((hit) => <HitCard hit={hit} key={`${hit.rank}-${hit.sourceTitle}-${hit.location.label}`} />)}
      </div>
    </Panel>
  );
}

function HitCard({ hit }: { hit: RetrievalPayload["hits"][number] }) {
  return (
    <article className="hit-card">
      <header>
        <div>
          <strong>#{hit.rank} {hit.sourceTitle}</strong>
          <small>{hit.author} · {hit.roleLabel} · {hit.location.label} · OCR {Math.round(hit.qualityScore * 100)}%</small>
        </div>
        <span className="score-badge">{hit.score}</span>
      </header>
      <p>{hit.excerpt}</p>
      <div className="hit-reason">
        <ArrowUpRight size={14} />
        {hit.rerankReason}
      </div>
      <div className="factor-grid">
        <span>lexical {hit.lexicalScore}</span>
        <span>semantic {hit.semanticScore}</span>
        <span>coverage {hit.coverageScore}</span>
        <span>penalty {hit.falseFriendPenalty}</span>
      </div>
      {hit.matchedFocusTerms.length ? (
        <div className="terms focus-terms">{hit.matchedFocusTerms.slice(0, 12).map((term) => <span key={term}>{term}</span>)}</div>
      ) : null}
      <div className="terms">{hit.matchedTerms.slice(0, 16).map((term) => <span key={term}>{term}</span>)}</div>
    </article>
  );
}

function List({ values, fallback }: { values: string[]; fallback: string }) {
  if (!values.length) return <p className="muted-text">{fallback}</p>;
  return (
    <ul className="nice-list">
      {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul>
  );
}

function DebugItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="debug-item">
      <span>{label}</span>
      <strong>{value || "لا يوجد"}</strong>
    </div>
  );
}

function ErrorDiagnostic({ error, result }: { error: string; result: ApiResponse | null }) {
  const debug = result?.debug;
  const err = debug?.error;

  return (
    <div className="error-panel">
      <div className="panel-title">
        <span className="title-icon"><Activity size={18} /></span>
        <h2>ديباق الخطأ</h2>
      </div>
      <p>{error}</p>
      <div className="debug-grid">
        <DebugItem label="requestId" value={debug?.requestId || result?.requestId || "غير متوفر"} />
        <DebugItem label="stage" value={debug?.stage || "غير معروف"} />
        <DebugItem label="error" value={result?.error || "غير معروف"} />
        <DebugItem label="status/code" value={[err?.status, err?.code].filter(Boolean).join(" / ") || "غير متوفر"} />
      </div>

      {err?.message ? <CodeDetails title="رسالة الخطأ الفعلية" value={err.message} open /> : null}
      {err?.provider ? <CodeDetails title="تفاصيل مزود Gemini" value={JSON.stringify(err.provider, null, 2)} open /> : null}
      {err?.attempts?.length ? <CodeDetails title="محاولات Gemini" value={JSON.stringify(err.attempts, null, 2)} open /> : null}
      {err?.rawPreview ? <CodeDetails title="raw preview" value={err.rawPreview} /> : null}
      {err?.stack?.length ? <CodeDetails title="stack" value={err.stack.join("\n")} /> : null}
    </div>
  );
}

function CodeDetails({ title, value, open = false }: { title: string; value: string; open?: boolean }) {
  return (
    <details className="details-card code-details" open={open}>
      <summary><ChevronDown size={16} /> {title}</summary>
      <pre>{value}</pre>
    </details>
  );
}
