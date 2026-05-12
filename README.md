# Dream Interpretation RAG System

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-000000?style=flat&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-000000?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Firebase-000000?style=flat&logo=firebase&logoColor=white" alt="Firebase" />
  <img src="https://img.shields.io/badge/GitHub-000000?style=flat&logo=github&logoColor=white" alt="GitHub" />
</p>

## Description

This project transforms local dream interpretation books and hadith files into a searchable index, then uses Gemini to formulate an Arabic answer based on retrieved excerpts.

## Current Data Overview

### Primary Interpretation Sources

- `public/Tafseer_AlAhlam_AlKabeer_BnSereen/Tafseer_AlAhlam_AlKabeer_BnSereen_djvu.txt`
  - Clearest current source.
  - Used as the primary interpretation source.
- `public/Ta_teer_Al_Anam_Fi_Tabeer_Al_Manam/*.txt`
  - Ta'teer Al-Anam by Al-Nabulsi, in two parts.
  - Useful text but contains OCR errors and word fusions.
- `public/Tabeer_Al_Roya/Tabeer_Al_Roya_Le_Ibn_Qutaybah_Al_Dinari_djvu.txt`
  - Very suitable for interpretation methodology and dream etiquette, not just a symbol dictionary.
- `scripts/Mawsoat_Al_Ahlam_Al_Ammah_djvu.txt`
  - Very poor OCR in samples, so low weight in the index.

### Supporting Sources

- `public/Al_Saheehan/Saheeh_Bukhari_djvu.xml`
- `public/Al_Saheehan/Saheeh_Muslim_Book_djvu.xml`

The two Sahih collections are used as supporting Sharia sources for dream etiquette and hadiths, not as symbol encyclopedias.

## How the System Works

```
TXT/XML Books
  ↓
Arabic Cleaning and Normalization
  ↓
Splitting into Chunks
  ↓
Local Search Index
  ↓
Retrieving Best Excerpts
  ↓
Sending Excerpts to Gemini
  ↓
Answer + Sources + Evaluation + Debug
```

## Commands

Install packages:

```bash
pnpm install
```

Build the index:

```bash
pnpm rag:build
```

Test search without Gemini:

```bash
pnpm rag:search "I saw a lion chasing me and I was afraid and entered the house"
```

Build the application:

```bash
pnpm build
```

Run the interface:

```bash
pnpm start
```

Then open:

```
http://localhost:3000
```

## Gemini

Put the key in `.env` with this name:

```bash
GOOGLE_AI_STUDIO_API_KEY=...
```

The default model is taken from:

```bash
GEMINI_TEXT_MODEL
```

Or:

```bash
GEMINI_COMPOSE_MODEL
```

If no value exists, the application uses `gemini-2.5-flash`.

Settings to resist quota issues and invalid responses:

```bash
GEMINI_LITE_MODEL=gemini-2.5-flash-lite
GEMINI_FALLBACK_MODELS=
GEMINI_MIN_REQUEST_INTERVAL_MS=12000
GEMINI_MAX_RETRIES=1
GEMINI_RETRY_BASE_DELAY_MS=1500
GEMINI_COMPOSE_MAX_OUTPUT_TOKENS=2200
```

Meaning:

- If `gemini-2.5-flash` rejects the request due to `429 RESOURCE_EXHAUSTED`, the application waits according to `retryDelay` then tries again.
- If the request remains rejected, it tries `GEMINI_LITE_MODEL`.
- `GEMINI_MIN_REQUEST_INTERVAL_MS=12000` slows down requests to not exceed the free plan limit quickly.
- The response is set to `responseMimeType: application/json`, however there is precautionary cleaning of the response if it returns inside ```json.

If the message appears:

```
Your prepayment credits are depleted
```

This is not a code issue; it means the Google AI Studio project balance itself has run out and needs billing/prepay management or another key/project.

If appears:

```
RESOURCE_EXHAUSTED / 429
```

This is usually a temporary rate limit. Wait for the `retryDelay` value or reduce request frequency.

## What the Debug Shows

The interface displays:

- Normalized dream text.
- Extracted search keywords.
- Number of filtered chunks.
- Best retrieved excerpts with source, author, and position.
- Score for each excerpt.
- Gemini's evaluation of search coverage, citation strength, and answer caution.
- Thought summary from Gemini if returned by the model.
- Stage where the request failed.
- Gemini attempts: model, attempt, request duration, success, status/code, and retryDelay.
- Partial retrieval if search succeeded but Gemini failed.

Note: Thought summary is not the raw internal reasoning chain, but a formal summary displayable when supported by Gemini.

## Future Development

The current version is a fast text RAG suitable for initial evaluation. After reviewing result quality, the next professional step:

1. OCR cleaning for Al-Nabulsi and the general encyclopedia.
2. Separating books into chapters and symbols like: lion, house, door, water.
3. Adding Qdrant and embeddings.
4. Adding reranker.
5. Saving user ratings to improve retrieval.
