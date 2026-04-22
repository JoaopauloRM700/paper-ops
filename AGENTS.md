# paper-ops for Codex

Use this repo as a local academic paper discovery workspace.

## Start Here

- Read `GEMINI.md` for the primary Gemini-facing workflow
- Read `README.md` for CLI usage and project shape
- Read `docs/ARCHITECTURE.md` and `docs/SETUP.md` for implementation details
- Keep updating `docs/session-history/2026-04-17-academic-paper-search.md` as decisions and actions evolve

## Public Surface

- `paper-ops` -> show the command menu
- `paper-ops search <query>` -> run a saved search
- `paper-ops csv <query>` -> export a CSV from saved runs for one search string
- Raw Boolean/literature query text -> route to `search`
- `paper-ops pipeline` -> process queued searches
- `paper-ops tracker` -> show prior search runs
- `paper-ops batch` -> process batch input
- `paper-ops-gemini <command>` -> one-shot Gemini wrapper for the same router

## Data Contract

- User/runtime artifacts: `data/*`, `reports/*`, `output/*`
- User-editable config: `config/sources.yml`, `.env`
- System files: `src/*`, `paper-ops.mjs`, `paper-ops-gemini.mjs`, `doctor.mjs`, `verify.mjs`, `modes/*`, `docs/*`, this file

Do not overwrite saved search artifacts unless the user explicitly asks for cleanup.
