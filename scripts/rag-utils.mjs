import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data", "rag");
export const CHUNKS_PATH = path.join(DATA_DIR, "chunks.jsonl");
export const INDEX_PATH = path.join(DATA_DIR, "index.json");
export const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const NON_WORD = /[^\p{L}\p{N}\s]+/gu;
const TATWEEL = /\u0640/g;

export const STOP_WORDS = new Set([
  "في",
  "من",
  "على",
  "إلى",
  "الى",
  "عن",
  "ما",
  "ماذا",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "هو",
  "هي",
  "هم",
  "هن",
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
  "كانني",
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
  "إنه",
  "انه",
  "فإن",
  "فان",
  "ومن",
  "فمن"
]);

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function htmlDecode(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function normalizeArabic(input) {
  return input
    .replace(TATWEEL, "")
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

export function lightStem(term) {
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
    value = value.replace(/(كما|هما|هما|كم|كن|نا|ها|هم|هن|ني|يه|ه|ي|ك)$/, "");
  }
  if (value.length > 3 && value.endsWith("ا") && !["رويا", "دنيا"].includes(value)) {
    value = value.slice(0, -1);
  }

  return value;
}

export function tokenize(input) {
  const expanded = [];
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

export function uniqueTerms(input) {
  return [...new Set(tokenize(input))];
}

export function countWords(input) {
  const words = input.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

export function cleanText(input) {
  return input
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([^\n])\n([^\n])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitWords(input) {
  return input.trim().split(/\s+/).filter(Boolean);
}

export function makeExcerpt(text, query, maxChars = 360) {
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

export function safeId(value) {
  return normalizeArabic(value)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0600-\u06ff-]+/gi, "")
    .slice(0, 80);
}

export function roleLabel(role) {
  const labels = {
    dream_primary: "مصدر تفسير رئيسي",
    methodology: "منهج تعبير الرؤيا",
    hadith_support: "مصدر حديثي مساند",
    secondary_low_ocr: "مصدر ثانوي OCR ضعيف"
  };
  return labels[role] ?? role;
}
