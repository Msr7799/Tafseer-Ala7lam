import fs from "node:fs";
import { INDEX_PATH, makeExcerpt, normalizeArabic, tokenize } from "./rag-utils.mjs";

const query = process.argv.slice(2).join(" ").trim();

if (!query) {
  console.error('Usage: pnpm rag:search "رأيت أسدا يلاحقني"');
  process.exit(1);
}

if (!fs.existsSync(INDEX_PATH)) {
  console.error("RAG index is missing. Run: pnpm rag:build");
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const queryTerms = tokenize(query);
const totalChunks = index.totalChunks || index.chunks.length;

function scoreChunk(chunk) {
  let lexical = 0;
  const words = chunk.normalized.split(/\s+/);

  for (const term of queryTerms) {
    if (!term) continue;
    const count = words.reduce((sum, word) => {
      if (word === term) return sum + 1;
      if (term.length >= 3 && word.includes(term)) return sum + 0.72;
      return sum;
    }, 0);
    if (count > 0) {
      const df = index.df?.[term] ?? 1;
      const idf = Math.log(1 + totalChunks / Math.max(1, df));
      lexical += (1 + Math.log(count)) * idf;
    }
  }

  const phraseBonus = chunk.normalized.includes(normalizeArabic(query)) ? 4 : 0;
  const lengthPenalty = Math.max(0.72, Math.min(1.12, 240 / Math.max(120, chunk.wordCount)));
  return (lexical + phraseBonus) * chunk.sourceWeight * chunk.roleWeight * chunk.qualityScore * lengthPenalty;
}

const hits = index.chunks
  .map((chunk) => ({ chunk, score: scoreChunk(chunk) }))
  .filter((hit) => hit.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

console.log(`Query: ${query}`);
console.log(`Terms: ${queryTerms.join(", ")}`);
console.log(`Hits: ${hits.length}\n`);

for (const [indexNumber, hit] of hits.entries()) {
  console.log(`${indexNumber + 1}. ${hit.chunk.sourceTitle} - ${hit.chunk.author}`);
  console.log(`   ${hit.chunk.location.label} | score=${hit.score.toFixed(2)} | ${hit.chunk.role}`);
  console.log(`   ${makeExcerpt(hit.chunk.text, query, 260)}\n`);
}
