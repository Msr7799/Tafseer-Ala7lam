import type { DreamContext } from "./dream-context";
const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const NON_WORD = /[^\p{L}\p{N}\s]+/gu;

export type ExpansionRule = {
  id: string;
  label: string;
  reason: string;
  terms: string[];
  variants: string[];
  focusTerms: string[];
  negativeTerms?: string[];
  patterns: RegExp[];
};

export type QueryExpansion = {
  dreamContext?: {
    dreamerLabel: string;
    subjectLabel: string;
    isReportedDream: boolean;
    confidence: number;
  };
  original: string;
  normalizedOriginal: string;
  canonicalDream: string;
  expandedQuery: string;
  queryVariants: string[];
  expandedTerms: string[];
  focusTerms: string[];
  negativeTerms: string[];
  triggeredRules: Array<Pick<ExpansionRule, "id" | "label" | "reason">>;
  symbolHints: string[];
  ambiguityWarnings: string[];
  termWeights: Record<string, number>;
};

const DIALECT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bطالقين\s+علي\b/g, "يطلقون علي"],
  [/\bطالق\s+علي\b/g, "يطلق علي"],
  [/\bطلقوا\s+علي\b/g, "أطلقوا علي"],
  [/\bيطقون\s+علي\b/g, "يضربونني"],
  [/\bامي\b/g, "أمي"],
  [/\bحلمانه\b/g, "رأت في المنام"],
  [/\bفيني\b/g, "بي"],
  [/\bاطالعها\b/g, "أنظر إليها"],
  [/\bالنجده\b/g, "النجدة"]
];

const RULES: ExpansionRule[] = [
  {
    id: "modern_bullet_to_classical_weapon",
    label: "الرصاص/إطلاق النار ← سهم، رمي، سلاح، جرح",
    reason: "كتب التعبير القديمة غالبًا لا تستعمل رمز الرصاصة الحديث؛ لذلك يُبحث عن أقرب الرموز القديمة: السهم، الرمي، الطعن، الجرح، السلاح.",
    patterns: [/رصاص|رصاصه|رصاصة|طلقه|طلقة|طلقتين|اطلاق\s+نار|إطلاق\s+نار|يطلقون\s+علي|يطلق\s+علي|اطلقوا\s+علي|أطلقوا\s+علي|طالقين\s+علي/],
    terms: ["سهم", "سهام", "سهمين", "نبل", "رمي", "رماه", "رموني", "مرمي", "رمح", "طعن", "طعنه", "جرح", "جراح", "قتل", "قتيل", "سلاح", "حرب", "ضرب"],
    variants: [
      "رأى أنه أصيب بسهم",
      "رأى أن أحدا رماه بسهم",
      "رأى أنه رمي بسلاح",
      "رأى أنه جرح بسلاح",
      "رأى أنه طعن",
      "رأى أنه قتل أو جرح"
    ],
    focusTerms: ["سهم", "سهام", "رمي", "رماه", "رمح", "طعن", "جرح", "قتل", "سلاح", "حرب", "ضرب"],
    negativeTerms: ["صنم", "يعبد", "عبادة", "معدن", "ذهب", "فضة", "صفر", "حديد", "طلاق", "امرأته", "امرأه", "زوجته"]
  },
  {
    id: "back_injury",
    label: "الظهر ← خلف، دبر، وراء، أذى من جهة غير مباشرة",
    reason: "رمز الظهر يحتاج توسيعًا إلى ألفاظ الخلف والدبر والوراء لأن النصوص القديمة لا تصوغها دائمًا بلفظ الظهر نفسه.",
    patterns: [/ظهر|ظهري|ظهره|من\s+الخلف|خلفي|وراي|وراء/],
    terms: ["ظهر", "ظهره", "دبر", "خلف", "وراء", "ورائه", "من ورائه", "غيب", "غدر", "أذى", "ضرر"],
    variants: ["رأى أنه أصيب في ظهره", "رأى أن أحدا رماه من خلفه", "رأى جرحا في ظهره", "رأى أذى من ورائه"],
    focusTerms: ["ظهر", "دبر", "خلف", "وراء", "ورائه", "جرح", "أذى", "ضرر"]
  },
  {
    id: "asking_for_help",
    label: "طلب النجدة ← استغاثة، استنصار، طلب عون",
    reason: "لفظ النجدة حديث نسبيًا في هذا السياق؛ الأقرب في المصادر القديمة هو الاستغاثة وطلب النصر والعون.",
    patterns: [/نجده|نجدة|انقذ|انقذيني|ساعد|ساعديني|استغيث|اطلب\s+منها|أطلب\s+منها/],
    terms: ["استغاث", "استغاثة", "استنصر", "نصر", "ينصر", "عون", "أعانه", "طلب", "صرخ", "خوف"],
    variants: ["رأى أنه يستغيث", "رأى أنه يطلب العون", "رأى أنه يستنصر", "رأى أنه خائف ويطلب النجدة"],
    focusTerms: ["استغاث", "استغاثة", "استنصر", "نصر", "عون", "خوف"]
  },
  {
    id: "mother_viewing_child",
    label: "الأم/الوالدة ← أم، والدة، ابنها",
    reason: "لأن الرائية هي الأم والرؤيا عن ابنها، يتم توسيع البحث لألفاظ الأم والوالدة والابن.",
    patterns: [/امي|أمي|ام\b|الأم|والدتي|والده|والدة/],
    terms: ["أم", "ام", "امه", "الأم", "والدة", "والدته", "ابن", "ابنها", "ولد", "ولدها"],
    variants: ["رأت الأم ابنها", "رأت الوالدة ولدها", "رأت أم أن ابنها مصاب"],
    focusTerms: ["ام", "امه", "والدة", "ابن", "ولد"]
  },
  {
    id: "two_hits",
    label: "العدد اثنان ← سهمين، ضربتين، جرحين، مرتين",
    reason: "عند ذكر طلقتين يتم توسيع العدد إلى سهمين أو جرحين أو ضربتين حتى لا يبقى البحث مقصورًا على كلمة طلقة.",
    patterns: [/طلقتين|طلقتان|رصاصتين|اثنين|اثنتين|مرتين|٢|2/],
    terms: ["اثنين", "اثنتين", "ثنتين", "سهمين", "ضربتين", "جرحين", "مرتين", "نصف"],
    variants: ["رأى أنه أصيب بسهمين", "رأى جرحين", "رأى ضربتين"],
    focusTerms: ["سهمين", "ضربتين", "جرحين", "مرتين"]
  }
];

export function normalizeForExpansion(input: string) {
  return input
    .replace(/\u0640/g, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(NON_WORD, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function applyDialectReplacements(input: string) {
  let value = input;
  for (const [pattern, replacement] of DIALECT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function addWeights(target: Record<string, number>, terms: string[], weight: number) {
  for (const term of terms) {
    const normalized = normalizeForExpansion(term);
    if (!normalized) continue;
    for (const part of normalized.split(/\s+/)) {
      if (part.length < 2) continue;
      target[part] = Math.max(target[part] ?? 1, weight);
    }
  }
}

export function expandDreamQuery(dream: string, dreamContext?: DreamContext): QueryExpansion {
  const canonicalDream = applyDialectReplacements(dream.trim());
  const normalizedOriginal = normalizeForExpansion(canonicalDream);
  const triggered = RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(normalizedOriginal) || pattern.test(dream)));

  const contextVariants = dreamContext
    ? [
        ...dreamContext.searchHints,
        dreamContext.isReportedDream && dreamContext.dreamerRole === "mother" && dreamContext.subjectRole === "user" ? "رأت الأم ابنها في المنام" : "",
        dreamContext.isReportedDream && dreamContext.subjectRole === "user" ? "رأى شخص قريب المستخدم في المنام" : ""
      ]
    : [];

  const queryVariants = unique([
    canonicalDream,
    ...contextVariants,
    ...triggered.flatMap((rule) => rule.variants),
    triggered.some((rule) => rule.id === "modern_bullet_to_classical_weapon") && triggered.some((rule) => rule.id === "back_injury")
      ? "رأى أنه أصيب بسهم في ظهره"
      : "",
    triggered.some((rule) => rule.id === "modern_bullet_to_classical_weapon") && triggered.some((rule) => rule.id === "back_injury")
      ? "رأى أن أحدا رماه من خلفه"
      : "",
    triggered.some((rule) => rule.id === "mother_viewing_child") && triggered.some((rule) => rule.id === "asking_for_help")
      ? "رأت الأم ابنها يستغيث بها"
      : ""
  ]);

  const contextTerms = dreamContext?.isReportedDream ? [dreamContext.dreamerLabel, dreamContext.subjectLabel, "رؤيا منقولة", "الرائي", "الشخص المرئي"] : [];
  const expandedTerms = unique([...triggered.flatMap((rule) => rule.terms), ...contextTerms]);
  const focusTerms = unique(triggered.flatMap((rule) => rule.focusTerms));
  const negativeTerms = unique(triggered.flatMap((rule) => rule.negativeTerms ?? []));
  const termWeights: Record<string, number> = {};

  addWeights(termWeights, expandedTerms, 1.18);
  addWeights(termWeights, focusTerms, 1.65);
  addWeights(termWeights, queryVariants, 1.12);

  const ambiguityWarnings: string[] = [];
  if (/يطلقون علي|يطلق علي|طالقين علي|طلقتين|طلقوا علي|اطلقوا علي/.test(normalizedOriginal)) {
    ambiguityWarnings.push("لفظ الطلق في اللهجة قد يختلط على الفهرس مع الطلاق؛ تم ترجيح معنى إطلاق النار وإضعاف نتائج الطلاق الزوجي.");
  }
  if (/رصاص/.test(normalizedOriginal)) {
    ambiguityWarnings.push("كلمة الرصاص في الكتب القديمة قد تعني معدن الرصاص لا الرصاصة؛ تم توسيع البحث إلى السهم والرمي والسلاح.");
  }
  if (dreamContext?.isReportedDream) {
    ambiguityWarnings.push(`هذه رؤيا منقولة: الرائي هو ${dreamContext.dreamerLabel}، والشخص المرئي هو ${dreamContext.subjectLabel}. تم ضبط الضمائر وسياق البحث بناءً على ذلك.`);
  }

  const symbolHints = triggered.map((rule) => `${rule.label}: ${rule.reason}`);
  const expandedQuery = unique([...queryVariants, ...expandedTerms, ...focusTerms]).join(" ");

  return {
    original: dream,
    dreamContext: dreamContext
      ? {
          dreamerLabel: dreamContext.dreamerLabel,
          subjectLabel: dreamContext.subjectLabel,
          isReportedDream: dreamContext.isReportedDream,
          confidence: dreamContext.confidence
        }
      : undefined,
    normalizedOriginal,
    canonicalDream,
    expandedQuery,
    queryVariants,
    expandedTerms,
    focusTerms,
    negativeTerms,
    triggeredRules: triggered.map(({ id, label, reason }) => ({ id, label, reason })),
    symbolHints,
    ambiguityWarnings,
    termWeights
  };
}
