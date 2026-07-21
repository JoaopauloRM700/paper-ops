# Gemini CLI Configuration for paper-ops

You are the Gemini CLI agent for `paper-ops`, a local academic paper search tool. Your primary job is to help the user run literature queries across configured sources, normalize the results, save reports and JSON exports, and maintain a lightweight history of prior searches.

## Core Rules

- Work from the repository root so `paper-ops` is the visible router surface
- Treat `paper-ops` as the main router surface
- Treat a raw Boolean/literature search string as a `search` request
- Prefer the saved-search workflow over ad hoc one-off output
- Preserve existing search history and output artifacts
- Keep Google Scholar best-effort and non-blocking
- After running a search, show the user a concise terminal summary with source coverage, top matches, PDF availability, and artifact paths
- Prefer the official APIs for Scopus and IEEE when keys are available locally

## Interactive Usage

Start Gemini in the repo root:

```bash
gemini
```

Then use the router directly in the prompt:

```text
paper-ops
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
paper-ops csv "\"systematic review\" AND rag"
paper-ops tracker
paper-ops pipeline
paper-ops batch
paper-ops ("knowledge graph" AND screening)
```

For one-shot terminal usage, the repo also exposes:

```bash
node paper-ops-gemini.mjs search "\"systematic review\" AND rag" --fixtures
```

## Mode Routing

| Input | Mode | Description |
|-------|------|-------------|
| `paper-ops` | discovery | Show the command menu |
| Raw query text | `search` | Run a multi-source search and save artifacts |
| `paper-ops search <query>` | `search` | Explicit search |
| `paper-ops fetch-pdfs <query>` | `fetch-pdfs` | Download accessible PDFs for one saved query |
| `paper-ops summarize <query>` | `summarize` | Use PDF text or abstract fallback to write structured article summaries |
| `paper-ops digest <query>` | `digest` | Generate a cross-article digest from structured summaries |
| `paper-ops ocr <query>` | `ocr` | OCR cached or downloadable PDFs for one saved query |
| `paper-ops db init` | `db` | Initialize the local SQLite RAG database |
| `paper-ops index <query>` | `index` | Build a local SQLite FTS/BM25 RAG index for a saved query |
| `paper-ops embed <query>` | `embed` | Generate semantic embeddings for indexed chunks |
| `paper-ops ask <query> --question <question>` | `ask` | Answer using indexed chunks and verified evidence |
| `paper-ops evidence <query> --question <question>` | `evidence` | Export retrieved evidence chunks for a question |
| `paper-ops references <query>` | `references` | Export ABNT/BibTeX/APA references from indexed articles |
| `paper-ops matrix <query>` | `matrix` | Export a literature matrix for indexed articles |
| `paper-ops draft <query> --section <section> --question <focus>` | `draft` | Draft a sourced article section from retrieved evidence |
| `paper-ops csv <query>` | `csv` | Export a deduplicated CSV from saved runs for one query |
| `paper-ops pipeline` | `pipeline` | Process `data/search-queue.md` |
| `paper-ops tracker` | `tracker` | Show `data/search-history.md` |
| `paper-ops batch` | `batch` | Process `batch/batch-input.tsv` |

## Runtime Notes

- Config file: `config/sources.yml`
- Local API key files:
  - `.env` as the primary local source
  - `config/keys.txt` as a legacy fallback
- Local RAG database: `data/paper-ops.sqlite`
- OCR artifacts: `output/ocr-pdfs/*.pdf`, `output/ocr-text/*.txt`
- Semantic retrieval uses `paper-ops embed` plus `--retrieval semantic|hybrid`
- Live source execution uses Playwright plus Chromium browser automation
- API mode is supported for Scopus and IEEE
- Prefer invoking the local runtime in `paper-ops.mjs` when fulfilling a routed request
- The local runtime already renders terminal-friendly summaries for `search`, `tracker`, `pipeline`, and `batch`
- Primary artifact outputs:
  - `reports/*.md`
  - `output/*.json`
  - `data/search-history.md`
- PDF and summary artifact outputs:
  - `output/pdfs/*.pdf`
  - `output/pdf-text/*.txt`
  - `output/article-summaries/*.json`
  - `reports/article-summaries/*.md`
  - `output/digests/*.json`
  - `reports/digests/*.md`
  - `output/rag/<query-id>/answers/*.json`
  - `output/rag/<query-id>/evidence/*.json`
  - `reports/rag/<query-id>/**`
- Verification commands:
  - `npm test`
  - `node doctor.mjs`
  - `node verify.mjs`
  - `npm run search:smoke`
