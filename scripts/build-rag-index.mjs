import fs from "node:fs";
import path from "node:path";
import {
  CHUNKS_PATH,
  DATA_DIR,
  INDEX_PATH,
  MANIFEST_PATH,
  ROOT,
  cleanText,
  countWords,
  ensureDataDir,
  htmlDecode,
  normalizeArabic,
  readJson,
  safeId,
  splitWords,
  uniqueTerms
} from "./rag-utils.mjs";

const CONFIG_PATH = path.join(ROOT, "rag.sources.json");
const config = readJson(CONFIG_PATH);
const chunkWords = Number(config.chunkWords ?? 230);
const overlapWords = Number(config.overlapWords ?? 45);

ensureDataDir();

const stats = [];
const chunks = [];
let chunkSeq = 0;

function makeChunkId(sourceId) {
  chunkSeq += 1;
  return `${sourceId}-${String(chunkSeq).padStart(6, "0")}`;
}

function addChunk(source, text, location, qualityScore = 1) {
  const cleaned = cleanText(text);
  const wordCount = countWords(cleaned);

  if (wordCount < 18) {
    return;
  }

  const normalized = normalizeArabic(cleaned);
  const terms = uniqueTerms(cleaned);
  const arabicChars = (cleaned.match(/[\u0600-\u06ff]/g) ?? []).length;
  const totalLetters = (cleaned.match(/\p{L}/gu) ?? []).length || 1;
  const arabicRatio = arabicChars / totalLetters;

  if (arabicRatio < 0.32 && source.role !== "secondary_low_ocr") {
    return;
  }

  chunks.push({
    id: makeChunkId(source.id),
    sourceId: source.id,
    sourceTitle: source.title,
    author: source.author,
    role: source.role,
    roleWeight: source.role === "dream_primary" ? 1.18 : source.role === "methodology" ? 0.95 : source.role === "hadith_support" ? 0.72 : 0.45,
    sourceWeight: Number(source.sourceWeight ?? 1),
    sourcePath: source.path,
    location,
    qualityScore,
    wordCount,
    text: cleaned,
    normalized,
    terms
  });
}

function chunkUnits(source, units) {
  let buffer = [];
  let bufferLocations = [];
  let currentWords = 0;

  const flush = () => {
    if (!buffer.length) {
      return;
    }
    const text = buffer.join("\n");
    const first = bufferLocations[0];
    const last = bufferLocations[bufferLocations.length - 1];
    addChunk(
      source,
      text,
      {
        kind: first.kind,
        label: first.label === last.label ? first.label : `${first.label} - ${last.label}`,
        start: first.start,
        end: last.end
      },
      average(bufferLocations.map((item) => item.qualityScore ?? 1))
    );

    if (overlapWords > 0) {
      const words = splitWords(text);
      const overlap = words.slice(-overlapWords).join(" ");
      buffer = overlap ? [overlap] : [];
      bufferLocations = overlap ? [last] : [];
      currentWords = countWords(overlap);
    } else {
      buffer = [];
      bufferLocations = [];
      currentWords = 0;
    }
  };

  for (const unit of units) {
    const words = splitWords(unit.text);
    if (words.length > chunkWords * 1.6) {
      for (let i = 0; i < words.length; i += chunkWords - overlapWords) {
        const part = words.slice(i, i + chunkWords).join(" ");
        addChunk(source, part, unit.location, unit.qualityScore);
      }
      continue;
    }

    buffer.push(unit.text);
    bufferLocations.push(unit.location);
    currentWords += words.length;

    if (currentWords >= chunkWords) {
      flush();
    }
  }

  flush();
}

function average(values) {
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function extractTextUnits(source, fullPath) {
  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
  const units = [];
  let buffer = [];
  let startLine = 1;

  const flush = (endLine) => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      units.push({
        text,
        location: {
          kind: "lines",
          label: `أسطر ${startLine}-${endLine}`,
          start: startLine,
          end: endLine,
          qualityScore: source.role === "secondary_low_ocr" ? 0.42 : 0.86
        }
      });
    }
    buffer = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      flush(lineNumber);
      startLine = lineNumber + 1;
      return;
    }

    if (!buffer.length) {
      startLine = lineNumber;
    }
    buffer.push(trimmed);
  });

  flush(lines.length);
  return units;
}

function extractDjvuXmlUnits(source, fullPath) {
  const xml = fs.readFileSync(fullPath, "utf8");
  const units = [];
  const objectRegex = /<OBJECT\b[\s\S]*?<\/OBJECT>/g;
  let pageIndex = 0;
  let match;

  while ((match = objectRegex.exec(xml))) {
    pageIndex += 1;
    const object = match[0];
    const pageName = object.match(/<PARAM\b[^>]*name="PAGE"[^>]*value="([^"]+)"/i)?.[1] ?? `page-${pageIndex}`;
    const words = [];
    const confidences = [];
    const wordRegex = /<WORD\b([^>]*)>([\s\S]*?)<\/WORD>/g;
    let wordMatch;

    while ((wordMatch = wordRegex.exec(object))) {
      const attrs = wordMatch[1] ?? "";
      const rawWord = htmlDecode(wordMatch[2] ?? "").trim();
      if (!rawWord) continue;

      const confidence = Number(attrs.match(/x-confidence="([^"]+)"/i)?.[1] ?? "65");
      confidences.push(Number.isFinite(confidence) ? confidence : 65);
      words.push(rawWord);
    }

    if (!words.length) {
      continue;
    }

    const text = words.join(" ");
    const avgConfidence = average(confidences) / 100;
    const arabicChars = (text.match(/[\u0600-\u06ff]/g) ?? []).length;
    const qualityScore = Math.max(0.2, Math.min(1, avgConfidence));

    if (arabicChars < 120 || qualityScore < 0.18) {
      continue;
    }

    units.push({
      text,
      location: {
        kind: "page",
        label: `صفحة OCR ${pageIndex} | ${pageName}`,
        start: pageIndex,
        end: pageIndex,
        qualityScore
      },
      qualityScore
    });
  }

  return units;
}

function buildDf(chunksList) {
  const df = new Map();
  for (const chunk of chunksList) {
    for (const term of chunk.terms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const compact = {};
  for (const [term, count] of df) {
    if (count >= 2 && term.length > 1) {
      compact[term] = count;
    }
  }
  return compact;
}

for (const source of config.sources.filter((item) => item.enabled !== false)) {
  const fullPath = path.join(ROOT, source.path);
  const started = Date.now();

  if (!fs.existsSync(fullPath)) {
    stats.push({ id: source.id, title: source.title, skipped: true, reason: "file_not_found" });
    continue;
  }

  const before = chunks.length;
  const units = source.format === "djvu-xml" ? extractDjvuXmlUnits(source, fullPath) : extractTextUnits(source, fullPath);
  chunkUnits(source, units);

  stats.push({
    id: source.id,
    title: source.title,
    author: source.author,
    role: source.role,
    format: source.format,
    path: source.path,
    units: units.length,
    chunks: chunks.length - before,
    ms: Date.now() - started
  });
}

const df = buildDf(chunks);
const payload = {
  builtAt: new Date().toISOString(),
  chunkWords,
  overlapWords,
  totalChunks: chunks.length,
  sources: stats,
  df,
  chunks
};

fs.writeFileSync(INDEX_PATH, JSON.stringify(payload), "utf8");
fs.writeFileSync(CHUNKS_PATH, chunks.map((chunk) => JSON.stringify(chunk)).join("\n"), "utf8");
fs.writeFileSync(
  MANIFEST_PATH,
  JSON.stringify(
    {
      builtAt: payload.builtAt,
      totalChunks: chunks.length,
      dataDir: path.relative(ROOT, DATA_DIR),
      indexPath: path.relative(ROOT, INDEX_PATH),
      chunksPath: path.relative(ROOT, CHUNKS_PATH),
      sources: stats
    },
    null,
    2
  ),
  "utf8"
);

console.log(`Built RAG index: ${chunks.length} chunks`);
for (const item of stats) {
  console.log(`- ${item.id}: ${item.chunks ?? 0} chunks from ${item.units ?? 0} units (${item.ms ?? 0}ms)`);
}
console.log(`Wrote ${path.relative(ROOT, INDEX_PATH)}`);
