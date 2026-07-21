# Setup

## Requirements

- Node.js 18+
- Playwright package installed in the repo
- Chromium browser installed for Playwright
- better-sqlite3 installed for the local RAG database
- Optional: OCRmyPDF/Tesseract for scanned PDF OCR

## First Run

1. Run `npm install`
2. Run `npx playwright install chromium`
3. Create `.env` from the tracked template and add your API keys:

```text
.env
SCOPUS_API_KEY=<your-scopus-key>
IEEE_API_KEY=<your-ieee-key>
WEB_OF_SCIENCE_API_KEY=<your-web-of-science-key>
PAPER_OPS_SUMMARY_CLI=gemini
PAPER_OPS_SUMMARY_TIMEOUT_MS=180000
PAPER_OPS_OCR_LANG=por+eng
PAPER_OPS_EMBEDDING_PROVIDER=openai
PAPER_OPS_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=<your-openai-key>
```

You can also keep using `config/keys.txt` as a fallback, but `.env` is now the primary local configuration path.

Environment variable precedence is:

1. process environment
2. `.env`
3. `config/keys.txt`

4. Review `config/sources.yml`
5. Run `node doctor.mjs`
6. Run `npm test`
7. Run a fixture-backed search:

```bash
node paper-ops.mjs search "\"systematic review\" AND rag" --fixtures
```

8. If you want PDF reading, summaries, digests, or answers, ensure Gemini CLI is available in your shell before running:

```bash
paper-ops summarize "\"systematic review\" AND rag"
paper-ops digest "\"systematic review\" AND rag"
paper-ops index "\"systematic review\" AND rag"
paper-ops ask "\"systematic review\" AND rag" --question "What methods are used?"
paper-ops evidence "\"systematic review\" AND rag" --question "What methods are used?"
paper-ops references "\"systematic review\" AND rag" --format all
paper-ops matrix "\"systematic review\" AND rag"
paper-ops draft "\"systematic review\" AND rag" --section related-work --question "What methods are used?"
paper-ops ask "\"systematic review\" AND rag" --question "What methods are used?" --refresh-text --refresh-index
```

## Gemini CLI Usage

Interactive:

```bash
gemini
```

Then type:

```text
paper-ops search "\"systematic review\" AND rag"
paper-ops fetch-pdfs "\"systematic review\" AND rag"
paper-ops summarize "\"systematic review\" AND rag"
paper-ops digest "\"systematic review\" AND rag"
paper-ops ocr "\"systematic review\" AND rag" --ocr-lang por+eng
paper-ops index "\"systematic review\" AND rag"
paper-ops embed "\"systematic review\" AND rag" --embedding-provider openai --embedding-model text-embedding-3-small
paper-ops ask "\"systematic review\" AND rag" --question "What methods are used?"
paper-ops ask "\"systematic review\" AND rag" --question "What methods are used?" --retrieval hybrid --embed
paper-ops evidence "\"systematic review\" AND rag" --question "What methods are used?"
paper-ops evidence "\"systematic review\" AND rag" --question "What methods are used?" --retrieval semantic --embed
paper-ops references "\"systematic review\" AND rag" --format all
paper-ops matrix "\"systematic review\" AND rag"
paper-ops draft "\"systematic review\" AND rag" --section related-work --question "What methods are used?"
paper-ops ask "\"systematic review\" AND rag" --question "What methods are used?" --refresh-text --refresh-index
paper-ops tracker
```

One-shot:

```bash
node paper-ops-gemini.mjs search "\"systematic review\" AND rag" --fixtures
```

The local runtime still writes `reports/*.md` and `output/*.json`, but it now also renders a terminal summary with source coverage, top results, PDF availability, and artifact paths.

For summary workflows, the runtime also writes:

- `output/pdfs/*.pdf`
- `output/pdf-text/*.txt`
- `output/ocr-pdfs/*.pdf`
- `output/ocr-text/*.txt`
- `output/article-summaries/*.json`
- `output/article-summaries/*.txt`
- `reports/article-summaries/*.md`
- `output/digests/*.json`
- `reports/digests/*.md`
- `output/answers/*.json`
- `reports/answers/*.md`
- `data/paper-ops.sqlite`
- `output/rag/<query-id>/answers/*.json`
- `output/rag/<query-id>/evidence/*.json`
- `reports/rag/<query-id>/**`

Summary fallback order:

1. extracted PDF text
2. saved article abstract already present in the search result
3. abstract enriched from the article landing page

When the landing page is too dynamic for a simple HTML fetch, the runtime can also fall back to Playwright on the article page and try lightweight interactions before extracting the abstract.

Local RAG workflow:

1. `paper-ops ocr "<query>" --ocr-lang por+eng` OCRs cached/downloadable PDFs when needed.
2. `paper-ops index "<query>" --ocr` initializes `data/paper-ops.sqlite`, reuses cached PDF/OCR text/abstracts, chunks text by page, and populates SQLite FTS5.
3. `paper-ops embed "<query>" --embedding-provider openai --embedding-model text-embedding-3-small` stores semantic vectors for chunks.
4. `paper-ops ask "<query>" --question "<question>" --retrieval hybrid --embed` retrieves top chunks from BM25 + semantic fusion, answers from those chunks, and stores answer/evidence rows.
5. `paper-ops evidence`, `references`, `matrix`, and `draft` reuse the same database for writing support.
6. Use `--refresh-index` when cached text changed and chunks should be rebuilt.
7. Use `--refresh-embeddings` when chunk embeddings should be regenerated.

## Live Sources

- Scopus: official Scopus Search API when `mode` is `api`, browser extraction otherwise
- IEEE: official IEEE Xplore Metadata API when `mode` is `api`, browser extraction otherwise
- ACM: browser-driven results extraction from the ACM Digital Library
- Google Scholar: experimental browser-driven extraction and best-effort only
- SciELO: free JSON API from SciELO Search when `mode` is `api`, browser extraction otherwise
- Web of Science: official Clarivate API when `mode` is `api`; set `WEB_OF_SCIENCE_API_KEY` or `WOS_API_KEY`
- Web of Science raw search strings are wrapped as `TS=(...)`; set `sources.web_of_science.raw_query` to `true` to pass advanced Web of Science syntax unchanged
