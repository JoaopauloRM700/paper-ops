# paper-ops

Gemini-first academic paper search tooling built for local, source-aware literature discovery. Run one search string across Scopus, IEEE, ACM, and an experimental Google Scholar adapter, deduplicate the results, and save both a readable report and a machine-readable JSON export.

## What It Does

- Accepts a raw Boolean or literature search string
- Queries enabled sources through a shared adapter contract
- Normalizes results into a common `PaperRecord` shape
- Deduplicates by DOI, then source identity, then title plus year
- Saves one markdown report and one JSON export per run
- Maintains a lightweight search history index
- Supports queue and batch processing for repeated searches

## Quick Start

```bash
git clone <your-repo-url>
cd paper-ops

# Inspect environment readiness
node doctor.mjs

# Run a fixture-backed smoke search
node paper-ops.mjs search "\"systematic review\" AND \"retrieval augmented generation\"" --fixtures

# Or treat raw query text as a search command
node paper-ops.mjs "\"knowledge graph\" AND screening" --fixtures
```

## Commands

```text
paper-ops search "<query>"   -> Run a multi-source search and save artifacts
paper-ops <query>            -> Treat raw query text as a search command
paper-ops pipeline           -> Process queued searches from data/search-queue.md
paper-ops tracker            -> Print the search history index
paper-ops batch              -> Process batch/batch-input.tsv
```

For resumable shell-based batch orchestration with logs and state tracking:

```bash
bash batch/batch-runner.sh --fixtures
```

## Configuration

The main config surface is `config/sources.yml`. It is stored as JSON-compatible YAML so it stays dependency-free and easy to edit.

Each source supports:

- `enabled`
- `mode`: `live` or `fixture`
- `api_key_env` where relevant
- `endpoint` where relevant
- `fixture` for local fixture-backed testing
- `experimental` for best-effort adapters like Google Scholar

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

- Scopus and IEEE expect BYO credentials in environment variables referenced by config.
- ACM live mode uses Crossref filtered to ACM-published work for a lightweight v1 path.
- Google Scholar is experimental and disabled by default in live mode.
