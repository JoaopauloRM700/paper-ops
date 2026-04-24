# paper-ops

PaperOps is academic paper search tooling built for local, source-aware literature discovery. Run one search string across Scopus, IEEE, ACM, and Google Scholar, combine official API-backed retrieval with browser-driven extraction where needed, deduplicate the results, and save both a readable report and a machine-readable JSON export.

This project was developed using [career-ops](https://github.com/santifer/career-ops) as its base. `paper-ops` reworks that operational foundation for academic paper discovery instead of job-search workflows.

## Credits

- Base project and operational inspiration: [santifer/career-ops](https://github.com/santifer/career-ops)
- `paper-ops` adapts that foundation to a literature-search workflow centered on Scopus, IEEE, ACM, and Google Scholar

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

## Requirements

- Node.js 18+
- `npm`
- Chromium for Playwright-driven sources
- Optional: Gemini CLI for the interactive Gemini-first workflow

## Dependencies

This project does require local dependencies before you can run live or fixture searches.

Required setup:

```bash
npm install
npx playwright install chromium
```

What each command does:

- `npm install` installs the Node.js runtime dependency declared in [package.json](D:/workspace/paper-ops/package.json), currently `playwright`
- `npx playwright install chromium` installs the Chromium browser binary used by browser-driven sources such as ACM and Google Scholar

Optional setup:

- install `gemini` in your shell if you want the interactive Gemini CLI workflow
- run `npm link` if you want to call `paper-ops` as a global local command instead of `node paper-ops.mjs`

## Quick Start

```bash
git clone <your-repo-url>
cd paper-ops

# Install required dependencies
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
node paper-ops.mjs ...       -> Direct local runtime
gemini                       -> Open Gemini CLI in this repository
paper-ops-gemini <command>   -> One-shot Gemini prompt through the paper-ops router
paper-ops search "<query>"   -> Run a multi-source search and save artifacts
paper-ops csv "<query>"      -> Export a deduplicated CSV from saved results for one search string
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

### Result limits per source

The number of articles returned per source is controlled in [sources.yml](D:/workspace/paper-ops/config/sources.yml).

You have two levels of control:

- `defaults.per_source_limit` sets the global default used by every source
- `sources.<source>.limit` optionally overrides that default for one specific source

Example:

```json
{
  "defaults": {
    "per_source_limit": 20
  },
  "sources": {
    "google_scholar": {
      "limit": 30
    }
  }
}
```

This limit is applied per source in each search run:

- `scopus` returns up to that many records
- `ieee` returns up to that many records
- `acm` returns up to that many records
- `google_scholar` now paginates across Scholar result pages until it reaches that limit or runs out of results

For Google Scholar, you can also tune pagination behavior with:

- `sources.google_scholar.max_pages`
- `sources.google_scholar.page_delay_ms`

Each source supports:

- `enabled`
- `mode`: `api`, `live`, or `fixture`
- `limit` to override the global per-source result limit
- `api_url` for official API-backed retrieval
- `search_url` for live browser navigation
- `fixture` for local fixture-backed testing
- `experimental` for best-effort adapters like Google Scholar

API keys are resolved in this order:

1. process environment variables such as `SCOPUS_API_KEY` and `IEEE_API_KEY`
2. local `.env`
3. local `config/keys.txt` fallback

## CSV Export

If you already have saved JSON exports in `output/`, you can generate a deduplicated CSV for one specific search string:

```bash
paper-ops csv "\"software testing\" AND ai"
```

This export:

- reads saved `.json` search results from `output/`
- filters them by the requested search string
- combines only matching runs
- deduplicates the combined records
- writes a CSV back into `output/`

There are also two helper scripts:

```bash
node json_to_csv.mjs "\"software testing\" AND ai"
node consolidate_all.mjs
```

- `json_to_csv.mjs` exports one CSV for one query
- `consolidate_all.mjs` generates one CSV per distinct saved query

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

- The dependency installation step is mandatory. Without `npm install`, the repo has no `playwright` package; without `npx playwright install chromium`, browser-driven sources will fail.
- Scopus and IEEE now default to official API-backed retrieval when local keys are available.
   IEEE Xplore API: https://developer.ieee.org/docs
   Elsevier Research Products APIs : https://dev.elsevier.com/
- `.env.example` is the tracked template. `.env` is local-only and ignored by git.
- ACM and Google Scholar remain browser-driven.
- Google Scholar is still experimental and best-effort, but it now paginates through Scholar result pages to honor `per_source_limit` more accurately.
- Pipeline and batch runs now avoid artifact-name collisions when the same query appears more than once in the same execution.
- Search-history links are now written relative to `data/search-history.md`, so the markdown links resolve correctly when opened directly.
- Fixture mode remains the primary verification path for tests and smoke checks.
- `pdf_available` is `true` when a PDF link is found, `false` when a source explicitly indicates no PDF, and `null` when availability could not be confirmed.
- Search runs now render a terminal summary with source coverage, top results, PDF status, and artifact paths in addition to saving `.md` and `.json` files.
