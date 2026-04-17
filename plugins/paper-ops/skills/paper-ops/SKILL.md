---
name: paper-ops
description: Academic paper search workflow for this repository. Use when the user wants to search literature across configured sources, process queued searches, inspect saved search runs, or run batch searches.
---

# paper-ops

## Load Order

1. Read repository-root `AGENTS.md`
2. Read `GEMINI.md` for the primary workflow
3. Read `README.md` for CLI usage
4. Load only the mode files needed for the request

## Mode Routing

| Input | Mode |
|-------|------|
| `paper-ops` with no args | discovery |
| Raw search string | search |
| `paper-ops search <query>` | search |
| `paper-ops pipeline` | pipeline |
| `paper-ops tracker` | tracker |
| `paper-ops batch` | batch |

## Context Loading

- Read `modes/_shared.md` plus the requested mode file
- Reuse the existing project data paths instead of inventing new ones
- Keep Google Scholar best-effort and non-blocking
