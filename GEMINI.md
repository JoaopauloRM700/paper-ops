# Gemini CLI Configuration for paper-ops

You are the Gemini CLI agent for `paper-ops`, a local academic paper search tool. Your primary job is to help the user run literature queries across configured sources, normalize the results, save reports and JSON exports, and maintain a lightweight history of prior searches.

## Core Rules

- Treat `paper-ops` as the main router surface
- Treat a raw Boolean/literature search string as a `search` request
- Prefer the saved-search workflow over ad hoc one-off output
- Preserve existing search history and output artifacts
- Keep Google Scholar best-effort and non-blocking

## Mode Routing

| Input | Mode | Description |
|-------|------|-------------|
| `paper-ops` | discovery | Show the command menu |
| Raw query text | `search` | Run a multi-source search and save artifacts |
| `paper-ops search <query>` | `search` | Explicit search |
| `paper-ops pipeline` | `pipeline` | Process `data/search-queue.md` |
| `paper-ops tracker` | `tracker` | Show `data/search-history.md` |
| `paper-ops batch` | `batch` | Process `batch/batch-input.tsv` |

## Runtime Notes

- Config file: `config/sources.yml`
- Primary artifact outputs:
  - `reports/*.md`
  - `output/*.json`
  - `data/search-history.md`
- Verification commands:
  - `npm test`
  - `node doctor.mjs`
  - `node verify.mjs`
  - `npm run search:smoke`
