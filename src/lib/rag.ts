import fs from "node:fs";
import path from "node:path";
import { expandDreamQuery, type QueryExpansion } from "./query-expansion";
import type { DreamContext } from "./dream-context";

export type RagRole = "dream_primary" | "methodology" | "hadith_support" | "secondary_low_ocr";

export type RagChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  author: string;
  role: RagRole;
  roleWeight: number;
  sourceWeight: number;
  sourcePath: string;
  location: {
    kind: string;
    label: string;
    start: number;
    end: number;
  };
  qualityScore: number;
  wordCount: number;
  text: string;
  normalized: string;
  terms: string[];
};

export type RagIndex = {
  builtAt: string;
  totalChunks: number;
  df: Record<string, number>;
  chunks: RagChunk[];
  sources: Array<{
    id: string;
    title: string;
    author: string;
    role: RagRole;
    chunks: number;
    units: number;
  }>;
};

export type RagHit = {
  rank: number;
  score: number;
  lexicalScore: number;
  phraseBonus: number;
  sourceScore: number;
  semanticScore: number;
  coverageScore: number;
  falseFriendPenalty: number;
  chunk: RagChunk;
  excerpt: string;
  matchedTerms: string[];
  matchedFocusTerms: string[];
  rerankReason: string;
};

export type RagSearchResult = {
  hits: RagHit[];
  debug: {
    query: string;
    normalizedQuery: string;
    expandedQuery: string;
    queryTerms: string[];
    expansion: QueryExpansion;
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
  index: Omit<RagIndex, "chunks" | "df">;
};

const INDEX_PATH = path.join(process.cwd(), "data", "rag", "index.json");
const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const NON_WORD = /[^\p{L}\p{N}\s]+/gu;

const STOP_WORDS = new Set([
  "في",
  "من",
  "على",
  "الى",
  "إلى",
  "عن",
  "ما",
  "ماذا",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "هو",
  "هي",
  "انا",
  "أني",
  "اني",
  "أن",
  "ان",
  "إن",
  "كان",
  "كانت",
  "كنت",
  "رأيت",
  "رايت",
  "حلمت",
  "كأن",
  "كأني",
  "ثم",
  "أو",
  "او",
  "و",
  "يا",
  "مع",
  "لي",
  "له",
  "لها",
  "به",
  "بها",
  "هناك",
  "كل",
  "غير",
  "قد",
  "لا",
  "لم",
  "لن",
  "ومن",
  "فمن",
  "انه",
  "أنها",
  "انها",
  "فيني",
  "ماتفسير",
  "تفسير"
]);

let cachedIndex: RagIndex | null = null;

export function normalizeArabic(input: string) {
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

export function lightStem(term: string) {
  let value = term;

  if (value.length > 4) {
    value = value.replace(/^(وال|فال|بال|كال|لل)/, "");
  }
  if (value.length > 3) {
    value = value.replace(/^[وف]/, "");
  }
  if (value.length > 4) {
    value = value.replace(/^ال/, "");
  }
  if (value.length > 4) {
    value = value.replace(/(كما|هما|كم|كن|نا|ها|هم|هن|ني|يه|ه|ي|ك)$/, "");
  }
  if (value.length > 3 && value.endsWith("ا") && !["رويا", "دنيا"].includes(value)) {
    value = value.slice(0, -1);
  }

  return value;
}

export function tokenize(input: string) {
  const expanded: string[] = [];
  const baseTerms = normalizeArabic(input)
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term) && !/^\d+$/.test(term));

  for (const term of baseTerms) {
    const stemmed = lightStem(term);
    expanded.push(term);
    if (stemmed !== term && stemmed.length > 1 && !STOP_WORDS.has(stemmed)) {
      expanded.push(stemmed);
    }
  }

  return expanded;
}

export function roleLabel(role: RagRole) {
  const labels: Record<RagRole, string> = {
    dream_primary: "مصدر تفسير رئيسي",
    methodology: "منهج تعبير الرؤيا",
    hadith_support: "مصدر حديثي مساند",
    secondary_low_ocr: "مصدر ثانوي OCR ضعيف"
  };
  return labels[role] ?? role;
}

export function indexExists() {
  return fs.existsSync(INDEX_PATH);
}

export function loadRagIndex() {
  if (cachedIndex) return cachedIndex;
  if (!indexExists()) {
    throw new Error("RAG_INDEX_MISSING");
  }
  cachedIndex = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as RagIndex;
  return cachedIndex;
}

export function makeExcerpt(text: string, query: string, maxChars = 520) {
  const normalizedText = normalizeArabic(text);
  const terms = tokenize(query);
  let bestIndex = 0;

  for (const term of terms) {
    const idx = normalizedText.indexOf(term);
    if (idx >= 0) {
      bestIndex = idx;
      break;
    }
  }

  const start = Math.max(0, bestIndex - Math.floor(maxChars / 2));
  const excerpt = text.slice(start, start + maxChars).trim();
  return `${start > 0 ? "..." : ""}${excerpt}${start + maxChars < text.length ? "..." : ""}`;
}

function termCount(normalizedText: string, term: string) {
  const words = normalizedText.split(/\s+/);
  return words.reduce((sum, word) => {
    if (word === term) return sum + 1;
    if (term.length >= 3 && word.includes(term)) return sum + 0.72;
    return sum;
  }, 0);
}

function roleGate(role: RagRole, queryTerms: string[]) {
  const hadithTerms = new Set(["الرؤيا", "رويا", "حلم", "الحلم", "المنام", "صالحه", "صادقه", "شيطان", "استعاذه", "استغاث"]);
  if (role !== "hadith_support") return 1;
  return queryTerms.some((term) => hadithTerms.has(term)) ? 1 : 0.54;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedTermSet(values: string[]) {
  const set = new Set<string>();
  for (const value of values) {
    for (const term of tokenize(value)) set.add(term);
  }
  return set;
}

function hasAny(normalizedText: string, terms: string[]) {
  return terms.some((term) => {
    const normalized = normalizeArabic(term);
    return normalized.length > 1 && normalizedText.includes(normalized);
  });
}

function calculatePhraseBonus(chunkNormalized: string, expansion: QueryExpansion) {
  let bonus = 0;
  for (const variant of expansion.queryVariants) {
    const normalizedVariant = normalizeArabic(variant);
    if (normalizedVariant.length > 10 && chunkNormalized.includes(normalizedVariant)) {
      bonus += 3.5;
    }
  }
  return Math.min(10, bonus);
}

function calculateFalseFriendPenalty(chunkNormalized: string, expansion: QueryExpansion, matchedFocusTerms: string[]) {
  const rules = new Set(expansion.triggeredRules.map((rule) => rule.id));
  let penalty = 1;

  if (rules.has("modern_bullet_to_classical_weapon")) {
    const looksLikeMetal = hasAny(chunkNormalized, ["صنم", "يعبد", "عبادة", "ذهب", "فضة", "صفر", "حديد", "معدن"]);
    const looksLikeDivorce = hasAny(chunkNormalized, ["طلق امراته", "طلق زوجته", "طلاق", "زوجته", "امرأته", "امراته"]);
    const hasWeaponFocus = matchedFocusTerms.some((term) => ["سهم", "سهام", "رمي", "رماه", "رمح", "طعن", "جرح", "قتل", "سلاح", "حرب", "ضرب"].includes(term));

    if ((looksLikeMetal || looksLikeDivorce) && !hasWeaponFocus) {
      penalty *= 0.28;
    } else if (looksLikeMetal || looksLikeDivorce) {
      penalty *= 0.62;
    }
  }

  if (expansion.negativeTerms.length && matchedFocusTerms.length === 0 && hasAny(chunkNormalized, expansion.negativeTerms)) {
    penalty *= 0.72;
  }

  return penalty;
}

function coverageLabel(matchedFocusTerms: string[], expansion: QueryExpansion) {
  if (!expansion.focusTerms.length) return "بحث حرفي بلا توسيع رمزي";
  if (matchedFocusTerms.length >= 4) return "مطابقة رمزية قوية";
  if (matchedFocusTerms.length >= 2) return "مطابقة رمزية متوسطة";
  if (matchedFocusTerms.length === 1) return "مطابقة رمزية ضعيفة";
  return "مطابقة لفظية فقط؛ لا يوجد رمز مركزي كافٍ";
}

export function searchRag(query: string, topK = 10, dreamContext?: DreamContext): RagSearchResult {
  const t0 = Date.now();
  const index = loadRagIndex();
  const t1 = Date.now();
  const expansion = expandDreamQuery(query, dreamContext);
  const tExpansion = Date.now();
  const normalizedQuery = normalizeArabic(expansion.canonicalDream);
  const expandedQuery = expansion.expandedQuery || query;
  const queryTerms = unique([...tokenize(query), ...tokenize(expandedQuery)]);
  const focusTermSet = normalizedTermSet(expansion.focusTerms);
  const totalChunks = index.totalChunks || index.chunks.length;

  const scored = index.chunks
    .map((chunk) => {
      let lexicalScore = 0;
      const matchedTerms: string[] = [];
      const matchedFocusTerms: string[] = [];

      for (const term of queryTerms) {
        const count = termCount(chunk.normalized, term);
        if (count > 0) {
          matchedTerms.push(term);
          if (focusTermSet.has(term)) matchedFocusTerms.push(term);
          const df = index.df?.[term] ?? 1;
          const idf = Math.log(1 + totalChunks / Math.max(1, df));
          const weight = expansion.termWeights[term] ?? 1;
          lexicalScore += (1 + Math.log(count)) * idf * weight;
        }
      }

      const phraseBonus = calculatePhraseBonus(chunk.normalized, expansion);
      const lengthPenalty = Math.max(0.72, Math.min(1.12, 260 / Math.max(120, chunk.wordCount)));
      const sourceScore = chunk.sourceWeight * chunk.roleWeight * chunk.qualityScore * roleGate(chunk.role, queryTerms);
      const coverageScore = expansion.focusTerms.length ? Math.min(1.55, 0.72 + matchedFocusTerms.length * 0.16) : 1;
      const semanticScore = expansion.triggeredRules.length ? Math.min(1.35, 0.94 + matchedFocusTerms.length * 0.075 + phraseBonus * 0.025) : 1;
      const falseFriendPenalty = calculateFalseFriendPenalty(chunk.normalized, expansion, matchedFocusTerms);
      const score = (lexicalScore + phraseBonus) * sourceScore * lengthPenalty * coverageScore * semanticScore * falseFriendPenalty;

      return {
        chunk,
        score,
        lexicalScore,
        phraseBonus,
        sourceScore,
        semanticScore,
        coverageScore,
        falseFriendPenalty,
        matchedTerms,
        matchedFocusTerms,
        rerankReason: coverageLabel(unique(matchedFocusTerms), expansion)
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  const hits: RagHit[] = scored.slice(0, topK).map((hit, indexNumber) => ({
    rank: indexNumber + 1,
    score: hit.score,
    lexicalScore: hit.lexicalScore,
    phraseBonus: hit.phraseBonus,
    sourceScore: hit.sourceScore,
    semanticScore: hit.semanticScore,
    coverageScore: hit.coverageScore,
    falseFriendPenalty: hit.falseFriendPenalty,
    chunk: hit.chunk,
    excerpt: makeExcerpt(hit.chunk.text, expandedQuery),
    matchedTerms: unique(hit.matchedTerms),
    matchedFocusTerms: unique(hit.matchedFocusTerms),
    rerankReason: hit.rerankReason
  }));

  const selectedSources: Record<string, number> = {};
  for (const hit of hits) {
    selectedSources[hit.chunk.sourceTitle] = (selectedSources[hit.chunk.sourceTitle] ?? 0) + 1;
  }

  const t2 = Date.now();
  return {
    hits,
    debug: {
      query,
      normalizedQuery,
      expandedQuery,
      queryTerms,
      expansion,
      totalChunks,
      candidatesWithScore: scored.length,
      selectedSources,
      timingsMs: {
        loadIndex: t1 - t0,
        expansion: tExpansion - t1,
        scoring: t2 - tExpansion,
        total: t2 - t0
      }
    },
    index: {
      builtAt: index.builtAt,
      totalChunks: index.totalChunks,
      sources: index.sources
    }
  };
}
