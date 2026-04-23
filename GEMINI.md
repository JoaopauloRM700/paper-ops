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
| `paper-ops csv <query>` | `csv` | Export a deduplicated CSV from saved runs for one query |
| `paper-ops pipeline` | `pipeline` | Process `data/search-queue.md` |
| `paper-ops tracker` | `tracker` | Show `data/search-history.md` |
| `paper-ops batch` | `batch` | Process `batch/batch-input.tsv` |

## Runtime Notes

- Config file: `config/sources.yml`
- Local API key files:
  - `.env` as the primary local source
  - `config/keys.txt` as a legacy fallback
- Live source execution uses Playwright plus Chromium browser automation
- API mode is supported for Scopus and IEEE
- Prefer invoking the local runtime in `paper-ops.mjs` when fulfilling a routed request
- The local runtime already renders terminal-friendly summaries for `search`, `tracker`, `pipeline`, and `batch`
- Primary artifact outputs:
  - `reports/*.md`
  - `output/*.json`
  - `data/search-history.md`
- Verification commands:
  - `npm test`
  - `node doctor.mjs`
  - `node verify.mjs`
  - `npm run search:smoke`
