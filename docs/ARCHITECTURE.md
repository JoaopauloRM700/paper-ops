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
  -> optional OCR for scanned/image-heavy PDFs
  -> optional local SQLite RAG indexing
  -> SQLite FTS/BM25, semantic, or hybrid chunk retrieval for questions and evidence tables
  -> per-article structured summaries
  -> optional cross-paper digest, question answer, references, matrix, or draft
```

## Core Modules

- `src/lib/cli.mjs` -> routing and menu behavior
- `src/lib/config.mjs` -> config loading and defaults
- `config/keys.txt` -> local, gitignored API keys for Scopus, IEEE, and Web of Science
- `src/lib/papers.mjs` -> `PaperRecord` normalization and deduplication
- `src/lib/browser-runtime.mjs` -> shared Playwright browser lifecycle for live searches
- `src/lib/adapters/*` -> source-specific live extraction and fixture normalization
- `src/lib/search-runner.mjs` -> orchestration and artifact writing
- `src/lib/pdf-extractor.mjs` -> PDF text extraction
- `src/lib/article-texts.mjs` -> saved query resolution, PDF/text cache reuse, and abstract fallback for RAG indexing
- `src/lib/ocr/*` -> OCRmyPDF adapter, query-level OCR workflow, and OCR artifact creation
- `src/lib/article-summarizer.mjs` -> Gemini-driven structured article summaries, cross-paper synthesis, and question answering
- `src/lib/article-digest.mjs` -> PDF download, PDF/abstract text selection, per-article summaries, digest orchestration, and PDF-grounded answers
- `src/lib/db/*` -> local SQLite connection and schema management
- `src/lib/rag/*` -> chunking, indexing, FTS retrieval, embeddings, semantic/hybrid retrieval, RAG answers, citations, references, evidence tables, matrices, and drafts
- `src/lib/pipeline.mjs` -> queued searches
- `src/lib/batch.mjs` -> TSV-backed batch input

## Artifact Model

- `reports/*.md` -> human-readable search reports
- `output/*.json` -> structured exports
- `data/search-history.md` -> lightweight run index
- `data/search-queue.md` -> queued searches
- `data/paper-ops.sqlite` -> local RAG database for articles, documents, chunks, FTS, answers, evidence, and references
- `output/pdfs/*.pdf` -> cached PDFs for saved search results
- `output/pdf-text/*.txt` -> extracted article text
- `output/ocr-pdfs/*.pdf` -> OCR-processed PDF copies
- `output/ocr-text/*.txt` -> OCR-extracted text artifacts
- `output/article-summaries/*.json` -> structured per-article summaries
- `output/article-summaries/*.txt` -> plain-text per-article summaries
- `reports/article-summaries/*.md` -> human-readable per-article summaries
- `output/digests/*.json` -> structured cross-paper digests
- `reports/digests/*.md` -> human-readable cross-paper digests
- `output/answers/*.json` -> structured answers to research questions
- `reports/answers/*.md` -> human-readable answers with supporting evidence
- `output/rag/<query-id>/answers/*.json` -> RAG answers backed by indexed chunks
- `output/rag/<query-id>/evidence/*.json` -> retrieved evidence tables
- `reports/rag/<query-id>/**` -> RAG answer, evidence, reference, matrix, and draft reports

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
- Current default API-mode sources are Scopus, IEEE, SciELO, and Web of Science
- Current default live browser sources are ACM and Google Scholar
- Browser failures are isolated per source so one blocked site does not fail the entire search run
- Summary workflows use the best available text source in this order:
  - extracted PDF text
  - saved abstract from the normalized `PaperRecord`
  - abstract enriched from the article landing page
- Landing-page enrichment first tries a direct HTML fetch and then falls back to Playwright for dynamic pages, including lightweight interactions such as opening an abstract panel or dismissing cookie banners.
- `paper-ops index` creates/updates the local SQLite RAG index for one saved query.
- `paper-ops ocr` OCRs cached/downloadable PDFs for one saved query and preserves OCR artifacts separately.
- `paper-ops embed` creates chunk embeddings for semantic retrieval.
- RAG indexing stores article metadata, extracted documents, page-aware chunks, references, and an FTS5 table for BM25 retrieval.
- `paper-ops ask` creates the index on demand when needed, retrieves top evidence chunks with BM25, semantic, or hybrid retrieval, and writes verified evidence to both SQLite and artifacts.
- `paper-ops evidence`, `references`, `matrix`, and `draft` reuse the same local database for writing workflows.
- Embeddings are stored locally in SQLite for V1 semantic retrieval. Hybrid retrieval combines BM25 and semantic ranks with reciprocal rank fusion.
