# paper-ops

Gemini-first academic paper search tooling built for local, source-aware literature discovery. Run one search string across Scopus, IEEE, ACM, and Google Scholar, combine official API-backed retrieval with browser-driven extraction where needed, deduplicate the results, and save both a readable report and a machine-readable JSON export.

## What It Does

- Accepts a raw Boolean or literature search string
- Queries enabled sources through a shared adapter contract
- Uses official APIs for Scopus and IEEE when keys are configured
- Uses browser-driven extraction for ACM and Google Scholar
- Normalizes results into a common `PaperRecord` shape
- Deduplicates by DOI, then source identity, then title plus year
- Enriches each record with PDF availability plus a direct PDF URL when it can be detected
- Saves one markdown report and one JSON export per run
- Maintains a lightweight search history index
- Supports queue and batch processing for repeated searches
- Uses Playwright plus Chromium for live source browsing and extraction

## Quick Start

```bash
git clone <your-repo-url>
cd paper-ops

# Install runtime dependencies
npm install
npx playwright install chromium

# Create local credentials
copy .env.example .env
# Then edit .env with your real keys

# Inspect environment readiness
node doctor.mjs

# Gemini-first interactive usage
gemini
# Then type:
# paper-ops search "\"systematic review\" AND \"retrieval augmented generation\""

# One-shot Gemini usage from the terminal
node paper-ops-gemini.mjs search "\"systematic review\" AND \"retrieval augmented generation\"" --fixtures

# Direct local runtime usage
node paper-ops.mjs search "\"systematic review\" AND \"retrieval augmented generation\"" --fixtures

# Or treat raw query text as a search command
node paper-ops.mjs "\"knowledge graph\" AND screening" --fixtures
```

## Usage

```text
gemini                       -> Open Gemini CLI in this repository
paper-ops-gemini <command>   -> One-shot Gemini prompt through the paper-ops router
paper-ops search "<query>"   -> Run a multi-source search and save artifacts
paper-ops <query>            -> Treat raw query text as a search command
paper-ops pipeline           -> Process queued searches from data/search-queue.md
paper-ops tracker            -> Print the search history index
paper-ops batch              -> Process batch/batch-input.tsv
```

`paper-ops.mjs` remains the local runtime. In Gemini-first usage, the agent should invoke that runtime and present the saved-search summary directly in the terminal.

For resumable shell-based batch orchestration with logs and state tracking:

```bash
bash batch/batch-runner.sh --fixtures
```

## Configuration

The main config surface is `config/sources.yml`. It is stored as JSON-compatible YAML so it stays dependency-free and easy to edit.

Each source supports:

- `enabled`
- `mode`: `api`, `live`, or `fixture`
- `api_url` for official API-backed retrieval
- `search_url` for live browser navigation
- `fixture` for local fixture-backed testing
- `experimental` for best-effort adapters like Google Scholar

API keys are resolved in this order:

1. process environment variables such as `SCOPUS_API_KEY` and `IEEE_API_KEY`
2. local `.env`
3. local `config/keys.txt` fallback

## Output Model

Every saved result uses the normalized `PaperRecord` shape:

```json
{
  "source": "scopus",
  "source_id": "SCOPUS-ALPHA",
  "title": "Evidence Mapping with RAG Pipelines",
  "authors": ["Ada Lovelace"],
  "year": 2024,
  "venue": "Journal of Evidence Automation",
  "doi": "10.1000/alpha",
  "url": "https://example.org/paper",
  "abstract": "Paper abstract",
  "pdf_available": true,
  "pdf_url": "https://example.org/paper.pdf",
  "matched_query": "\"systematic review\" AND rag",
  "retrieved_at": "2026-04-17T15:00:00.000Z"
}
```

Saved artifacts:

- `reports/<run-id>.md`
- `output/<run-id>.json`
- `data/search-history.md`

## Validation

```bash
npm test
node test-all.mjs
node doctor.mjs
node verify.mjs
npm run search:smoke
```

## Notes

- Scopus and IEEE now default to official API-backed retrieval when local keys are available.
- `.env.example` is the tracked template. `.env` is local-only and ignored by git.
- ACM and Google Scholar remain browser-driven.
- Google Scholar is still experimental and best-effort.
- Fixture mode remains the primary verification path for tests and smoke checks.
- `pdf_available` is `true` when a PDF link is found, `false` when a source explicitly indicates no PDF, and `null` when availability could not be confirmed.
- Search runs now render a terminal summary with source coverage, top results, PDF status, and artifact paths in addition to saving `.md` and `.json` files.
