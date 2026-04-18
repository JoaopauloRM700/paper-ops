# Architecture

## Flow

```text
query string
  -> CLI/router
  -> config + enabled source adapters
  -> shared source orchestration
  -> official APIs for api-mode sources
  -> shared Playwright browser runtime for live sources
  -> source-specific normalization
  -> PaperRecord[]
  -> deduplication
  -> markdown report + JSON export
  -> search history index
```

## Core Modules

- `src/lib/cli.mjs` -> routing and menu behavior
- `src/lib/config.mjs` -> config loading and defaults
- `config/keys.txt` -> local, gitignored API keys for Scopus/IEEE
- `src/lib/papers.mjs` -> `PaperRecord` normalization and deduplication
- `src/lib/browser-runtime.mjs` -> shared Playwright browser lifecycle for live searches
- `src/lib/adapters/*` -> source-specific live extraction and fixture normalization
- `src/lib/search-runner.mjs` -> orchestration and artifact writing
- `src/lib/pipeline.mjs` -> queued searches
- `src/lib/batch.mjs` -> TSV-backed batch input

## Artifact Model

- `reports/*.md` -> human-readable search reports
- `output/*.json` -> structured exports
- `data/search-history.md` -> lightweight run index
- `data/search-queue.md` -> queued searches

## Dedup Order

1. DOI exact match
2. Source ID / source URL identity
3. Normalized title plus year

When duplicates are merged, the first retained record is enriched with any missing metadata discovered later, including `pdf_available` and `pdf_url`.

## Live Search Model

- Fixture mode uses local JSON fixtures for deterministic tests
- API mode uses official metadata/search endpoints for supported sources
- Live mode launches one shared Playwright Chromium runtime per search run
- Each source adapter builds its own search URL and extracts visible article metadata from the result page
- Browser failures are isolated per source so one blocked site does not fail the entire search run
