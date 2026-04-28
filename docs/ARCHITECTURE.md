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
  -> optional PDF download + text extraction
  -> per-article structured summaries
  -> optional cross-paper digest
```

## Core Modules

- `src/lib/cli.mjs` -> routing and menu behavior
- `src/lib/config.mjs` -> config loading and defaults
- `config/keys.txt` -> local, gitignored API keys for Scopus/IEEE
- `src/lib/papers.mjs` -> `PaperRecord` normalization and deduplication
- `src/lib/browser-runtime.mjs` -> shared Playwright browser lifecycle for live searches
- `src/lib/adapters/*` -> source-specific live extraction and fixture normalization
- `src/lib/search-runner.mjs` -> orchestration and artifact writing
- `src/lib/pdf-extractor.mjs` -> PDF text extraction
- `src/lib/article-summarizer.mjs` -> Gemini-driven structured article summaries and cross-paper synthesis
- `src/lib/article-digest.mjs` -> PDF download, PDF/abstract text selection, per-article summaries, and digest orchestration
- `src/lib/pipeline.mjs` -> queued searches
- `src/lib/batch.mjs` -> TSV-backed batch input

## Artifact Model

- `reports/*.md` -> human-readable search reports
- `output/*.json` -> structured exports
- `data/search-history.md` -> lightweight run index
- `data/search-queue.md` -> queued searches
- `output/pdfs/*.pdf` -> cached PDFs for saved search results
- `output/pdf-text/*.txt` -> extracted article text
- `output/article-summaries/*.json` -> structured per-article summaries
- `output/article-summaries/*.txt` -> plain-text per-article summaries
- `reports/article-summaries/*.md` -> human-readable per-article summaries
- `output/digests/*.json` -> structured cross-paper digests
- `reports/digests/*.md` -> human-readable cross-paper digests

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
- Summary workflows use the best available text source in this order:
  - extracted PDF text
  - saved abstract from the normalized `PaperRecord`
  - abstract enriched from the article landing page
- Landing-page enrichment first tries a direct HTML fetch and then falls back to Playwright for dynamic pages, including lightweight interactions such as opening an abstract panel or dismissing cookie banners.
