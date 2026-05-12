const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const NON_WORD = /[^\p{L}\p{N}\s]+/gu;

export type DreamPersonRole =
  | "user"
  | "mother"
  | "father"
  | "wife"
  | "husband"
  | "sister"
  | "brother"
  | "daughter"
  | "son"
  | "friend"
  | "other"
  | "unknown";

export type DreamContext = {
  originalText: string;
  normalizedText: string;
  narratorRole: "user";
  narratorLabel: string;
  dreamerRole: DreamPersonRole;
  dreamerLabel: string;
  subjectRole: DreamPersonRole;
  subjectLabel: string;
  relationship?: string;
  isReportedDream: boolean;
  confidence: number;
  facts: string[];
  grammarGuidance: string[];
  searchHints: string[];
  warnings: string[];
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  why: string;
  appliesTo: "dreamer" | "subject" | "both" | "dream";
  priority: number;
  inputType: "text" | "select";
  choices?: string[];
  optional?: boolean;
};

export type ClarificationPlan = {
  needsClarification: boolean;
  contextQuality: "complete" | "usable" | "missing_key_context";
  canAnswerWithoutQuestions: boolean;
  missingContext: string[];
  questions: ClarifyingQuestion[];
  answeredQuestions: Array<{
    id: string;
    question: string;
    answer: string;
  }>;
  note: string;
};

const RELATIONS: Array<{
  role: DreamPersonRole;
  label: string;
  patterns: string[];
}> = [
  { role: "mother", label: "الأم", patterns: ["امي", "امى", "والدتي", "الوالده", "الام", "ام"] },
  { role: "father", label: "الأب", patterns: ["ابي", "ابوي", "والدي", "الوالد", "الاب"] },
  { role: "wife", label: "الزوجة", patterns: ["زوجتي", "مرتي", "حرمتي"] },
  { role: "husband", label: "الزوج", patterns: ["زوجي", "ريلي"] },
  { role: "sister", label: "الأخت", patterns: ["اختي", "شقيقتي"] },
  { role: "brother", label: "الأخ", patterns: ["اخي", "اخوي", "شقيقي"] },
  { role: "daughter", label: "البنت", patterns: ["بنتي", "ابنتي"] },
  { role: "son", label: "الابن", patterns: ["ولدي", "ابني"] },
  { role: "friend", label: "صديق/صديقة", patterns: ["صديقي", "صديقتي", "رفيجي", "رفيجتي"] }
];

const DREAM_VERB = "(?:حلمت|حلمان|حلمانه|حلمتلي|رات|رايت|رأت|شافت|شاف|شايفه|شافني|راتني|رأتني)";
const SELF_OBJECT = "(?:فيني|بي|عني|علي|انا|اني|إني|انني|رأتني|راتني|شافتني|شافني)";

export function normalizeContextArabic(input: string) {
  return input
    .replace(/\u0640/g, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/گ/g, "ك")
    .replace(/پ/g, "ب")
    .replace(/چ/g, "ج")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(NON_WORD, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function relationPattern(patterns: string[]) {
  return `(?:${patterns.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
}

function hasSelfObject(text: string) {
  return new RegExp(SELF_OBJECT).test(text);
}

function hasFirstPersonDreamVerb(text: string) {
  return /(?:^|\s)(?:انا\s+)?(?:حلمت|رايت|رأيت|شفت)\b/.test(text);
}

function subjectRelationInsideUserDream(text: string) {
  if (!hasFirstPersonDreamVerb(text)) return null;

  for (const relation of RELATIONS) {
    const relationRegex = new RegExp(`(?:حلمت|رايت|رأيت|شفت).{0,35}${relationPattern(relation.patterns)}`);
    if (relationRegex.test(text)) return relation;
  }

  return null;
}

export function extractDreamContext(input: string): DreamContext {
  const normalizedText = normalizeContextArabic(input);
  const base: DreamContext = {
    originalText: input,
    normalizedText,
    narratorRole: "user",
    narratorLabel: "المستخدم ناقل الرؤيا",
    dreamerRole: "user",
    dreamerLabel: "المستخدم",
    subjectRole: "unknown",
    subjectLabel: "غير محدد",
    isReportedDream: false,
    confidence: 0.64,
    facts: ["ناقل الرؤيا هو المستخدم."],
    grammarGuidance: ["إذا لم يتضح غير ذلك، خاطب المستخدم بصفته الرائي."],
    searchHints: [],
    warnings: []
  };

  const subjectInsideUserDream = subjectRelationInsideUserDream(normalizedText);
  if (subjectInsideUserDream) {
    return {
      ...base,
      subjectRole: subjectInsideUserDream.role,
      subjectLabel: subjectInsideUserDream.label,
      confidence: 0.74,
      facts: ["ناقل الرؤيا هو المستخدم.", `الرائي الظاهر من النص هو المستخدم، و${subjectInsideUserDream.label} شخصية داخل الرؤيا.`],
      grammarGuidance: ["يجوز قول: رأيتَ أو حلمتَ؛ لأن المستخدم هو الرائي في هذه الصياغة."],
      searchHints: [subjectInsideUserDream.label]
    };
  }

  for (const relation of RELATIONS) {
    const rel = relationPattern(relation.patterns);
    const relationSawUser = new RegExp(`${rel}.{0,28}${DREAM_VERB}.{0,45}${SELF_OBJECT}`).test(normalizedText);
    const relationSawMeShort = new RegExp(`${rel}.{0,18}(?:راتني|رأتني|شافتني|شافني|حلمت\s+فيني|حلمانه\s+فيني)`).test(normalizedText);
    const relationDreamOnly = new RegExp(`${rel}.{0,22}${DREAM_VERB}`).test(normalizedText);

    if (relationSawUser || relationSawMeShort || (relationDreamOnly && hasSelfObject(normalizedText))) {
      return {
        ...base,
        dreamerRole: relation.role,
        dreamerLabel: relation.label,
        subjectRole: "user",
        subjectLabel: "المستخدم / الشخص المرئي في المنام",
        relationship: `${relation.role}_saw_user`,
        isReportedDream: true,
        confidence: relationSawUser || relationSawMeShort ? 0.94 : 0.82,
        facts: [
          "ناقل الرؤيا هو المستخدم.",
          `الرائي الحقيقي هو ${relation.label}.`,
          "الشخص المرئي في المنام هو المستخدم، وليس هو الرائي.",
          "هذه رؤيا منقولة عن شخص آخر."
        ],
        grammarGuidance: [
          `لا تقل للمستخدم: حلمك أو رأيتَ، لأن الرائي هو ${relation.label}.`,
          `استعمل صياغة: رأت ${relation.label} أنك... أو الرؤيا التي رأتْها ${relation.label} عنك...`,
          "عند طلب معلومات إضافية، اسأل عن حال الشخص المرئي في المنام إذا كان هو محور الرؤيا."
        ],
        searchHints: [relation.label, "ابن", "ولد", "رأت الأم ابنها", "رؤيا منقولة"],
        warnings: ["تم اكتشاف رؤيا منقولة؛ يجب ضبط الضمائر قبل التفسير."]
      };
    }
  }

  if (hasFirstPersonDreamVerb(normalizedText)) {
    return {
      ...base,
      dreamerRole: "user",
      dreamerLabel: "المستخدم",
      subjectRole: hasSelfObject(normalizedText) ? "user" : "unknown",
      subjectLabel: hasSelfObject(normalizedText) ? "المستخدم" : "غير محدد",
      confidence: 0.78,
      facts: ["ناقل الرؤيا هو المستخدم.", "الرائي الظاهر من الصياغة هو المستخدم."],
      grammarGuidance: ["يجوز قول: رؤياك أو حلمك لأن المستخدم هو الرائي حسب النص."],
      searchHints: ["الرائي المستخدم"]
    };
  }

  return {
    ...base,
    warnings: ["لم يتضح الرائي من النص بدرجة عالية؛ قد يحتاج النظام سؤال توضيحي."]
  };
}

function hasAnswer(answers: Record<string, string> | undefined, id: string) {
  return Boolean(answers?.[id]?.trim());
}

function isWeaponOrInjuryDream(text: string) {
  return /رصاص|طلق|اطلاق|إطلاق|سهم|طعن|جرح|قتل|ضرب|سلاح|ظهر|خلف|نجده|نجدة|استغاث/.test(text);
}

function isFamilyReportedDream(context: DreamContext) {
  return context.isReportedDream && ["mother", "father", "wife", "husband", "sister", "brother"].includes(context.dreamerRole);
}

export function buildClarificationPlan(
  input: string,
  context: DreamContext,
  answers: Record<string, string> = {}
): ClarificationPlan {
  const normalized = normalizeContextArabic(input);
  const questions: ClarifyingQuestion[] = [];
  const missingContext: string[] = [];

  if (context.dreamerRole === "unknown" || context.confidence < 0.7) {
    missingContext.push("من هو الرائي الحقيقي؟");
    questions.push({
      id: "dreamer_identity",
      question: "من الذي رأى الحلم بالضبط: أنت، أم شخص آخر؟",
      why: "تحديد الرائي يغير صياغة التفسير ومعنى القرائن.",
      appliesTo: "dreamer",
      priority: 100,
      inputType: "select",
      choices: ["أنا", "أمي", "أبي", "زوجتي/زوجي", "أختي/أخي", "شخص آخر"]
    });
  }

  if ((context.subjectRole === "user" || context.subjectRole === "unknown") && !hasAnswer(answers, "subject_profile")) {
    missingContext.push("حال الشخص المرئي في المنام");
    questions.push({
      id: "subject_profile",
      question: context.subjectRole === "user" ? "ما عمرك التقريبي وحالتك الاجتماعية؟" : "ما عمر الشخص المرئي وحالته الاجتماعية؟",
      why: "بعض تعبيرات الرؤى تختلف باختلاف السن والحالة الاجتماعية والمسؤوليات.",
      appliesTo: "subject",
      priority: 92,
      inputType: "text"
    });
  }

  if (isWeaponOrInjuryDream(normalized) && !hasAnswer(answers, "current_pressure")) {
    missingContext.push("وجود ضغط أو خصومة أو خوف واقعي");
    questions.push({
      id: "current_pressure",
      question: "هل تمر حاليًا بضغط، خلاف، مشكلة عمل/عائلة، أو خوف من شخص معيّن؟",
      why: "رموز الإصابة والظهر والنجدة قد تتأثر بوجود ضغط أو أذى معنوي أو خذلان في الواقع.",
      appliesTo: context.subjectRole === "user" ? "subject" : "dream",
      priority: 88,
      inputType: "text"
    });
  }

  if (isFamilyReportedDream(context) && !hasAnswer(answers, "dreamer_emotion")) {
    missingContext.push("شعور الرائي أثناء الرؤيا وبعدها");
    questions.push({
      id: "dreamer_emotion",
      question: `ما كان شعور ${context.dreamerLabel} في الحلم وبعد الاستيقاظ: خوف شديد، قلق عادي، أم تكررت الرؤيا؟`,
      why: "رؤيا الأم أو القريب عنك قد تكون مرتبطة بالخوف عليك أو الانشغال بحالك.",
      appliesTo: "dreamer",
      priority: 82,
      inputType: "text"
    });
  }

  if (/ظهر|ظهري|خلف|وراء/.test(normalized) && !hasAnswer(answers, "back_symbol_context")) {
    questions.push({
      id: "back_symbol_context",
      question: "هل عندك موضوع تشعر فيه أن الضرر جاءك من الخلف: غيبة، خذلان، أو شيء لم تكن تتوقعه؟",
      why: "هذا السؤال لا يثبت المعنى، لكنه يساعد على التفريق بين قياس رمزي عام وقرينة واقعية.",
      appliesTo: "subject",
      priority: 66,
      inputType: "text",
      optional: true
    });
  }

  const unanswered = questions
    .filter((question) => !hasAnswer(answers, question.id))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4);

  const answeredQuestions = questions
    .filter((question) => hasAnswer(answers, question.id))
    .map((question) => ({ id: question.id, question: question.question, answer: answers[question.id].trim() }));

  const requiredUnanswered = unanswered.filter((question) => !question.optional);
  const needsClarification = requiredUnanswered.length > 0 && Object.keys(answers).length === 0;

  return {
    needsClarification,
    contextQuality: requiredUnanswered.length ? "missing_key_context" : answeredQuestions.length ? "complete" : "usable",
    canAnswerWithoutQuestions: true,
    missingContext,
    questions: unanswered,
    answeredQuestions,
    note: needsClarification
      ? "الأسئلة ستجعل التفسير أدق. يمكن تخطيها، لكن سيصبح الجواب عامًا وحذرًا."
      : answeredQuestions.length
        ? "تم دمج إجابات المستخدم في التفسير."
        : "السياق كافٍ مبدئيًا، ويمكن إعطاء جواب حذر."
  };
}

export function formatAnsweredQuestions(plan: ClarificationPlan) {
  if (!plan.answeredQuestions.length) return "لا توجد إجابات توضيحية من المستخدم.";
  return plan.answeredQuestions.map((item) => `- ${item.question}\n  الإجابة: ${item.answer}`).join("\n");
}
