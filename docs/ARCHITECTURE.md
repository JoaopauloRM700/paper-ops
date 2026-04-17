# Architecture

## Flow

```text
query string
  -> CLI/router
  -> config + enabled source adapters
  -> source-specific normalization
  -> PaperRecord[]
  -> deduplication
  -> markdown report + JSON export
  -> search history index
```

## Core Modules

- `src/lib/cli.mjs` -> routing and menu behavior
- `src/lib/config.mjs` -> config loading and defaults
- `src/lib/papers.mjs` -> `PaperRecord` normalization and deduplication
- `src/lib/adapters/*` -> source-specific extraction and normalization
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
