---
name: paper-ops
description: Academic paper search workflow for this repository. Use when the user wants to search literature across configured sources, process queued searches, inspect saved search runs, or run batch searches.
---

# paper-ops

## Load Order

1. Read repository-root `AGENTS.md`.
2. Read `GEMINI.md` for the primary workflow.
3. Read `README.md` for CLI usage and project shape.
4. Load only the mode files needed for the current request.

## Mode Routing

Treat the user's message after the `paper-ops` prefix as the mode selector.

| Input | Mode |
|-------|------|
| `paper-ops` with no args | `discovery` |
| Raw Boolean or literature query | `search` |
| `paper-ops search <query>` | `search` |
| `paper-ops pipeline` | `pipeline` |
| `paper-ops tracker` | `tracker` |
| `paper-ops batch` | `batch` |

If the user does not use the `paper-ops` prefix but clearly provides a literature search string, route to `search` anyway.

## Discovery

If no mode or query is provided, show this menu:

```text
paper-ops -- Academic Paper Search

Available prompts:
  paper-ops search "<query>"   -> Multi-source search + saved report + JSON
  paper-ops <query>            -> Treat raw query text as a search request
  paper-ops pipeline           -> Process queued searches from data/search-queue.md
  paper-ops tracker            -> Show saved search history
  paper-ops batch              -> Process batch/batch-input.tsv
```

## Context Loading

- Read `modes/_shared.md` plus the requested mode file.
- Reuse the existing project data paths instead of inventing new ones.
- Keep Google Scholar best-effort and non-blocking.

## Batch Note

For repository batch automation, prefer `bash batch/batch-runner.sh --fixtures` during smoke testing.
