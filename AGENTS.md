# paper-ops for Codex

Use this repo as a local academic paper discovery workspace.

## Start Here

- Read `GEMINI.md` for the primary Gemini-facing workflow
- Read `README.md` for CLI usage and project shape
- Read `docs/ARCHITECTURE.md` and `docs/SETUP.md` for implementation details
- Keep updating `docs/session-history/2026-04-17-academic-paper-search.md` as decisions and actions evolve

## Public Surface

- Default sources: Scopus, IEEE, ACM, Google Scholar, SciELO, and Web of Science
- `paper-ops` -> show the command menu
- `paper-ops search <query>` -> run a saved search
- `paper-ops fetch-pdfs <query>` -> download PDFs from saved results for one query
- `paper-ops summarize <query>` -> extract PDF text and write structured article summaries
- `paper-ops digest <query>` -> synthesize structured summaries into a search-level digest
- `paper-ops db init` -> initialize the local SQLite RAG database
- `paper-ops ocr <query>` -> OCR cached/downloadable PDFs for a saved query
- `paper-ops index <query>` -> build the local RAG index for one saved query
- `paper-ops embed <query>` -> generate semantic embeddings for indexed chunks
- `paper-ops ask <query> --question <question>` -> answer a question using indexed chunks and verified evidence
- `paper-ops ask <query> --question <question> --retrieval hybrid --embed` -> answer with BM25 + semantic retrieval
- `paper-ops evidence <query> --question <question>` -> export retrieved evidence chunks
- `paper-ops references <query>` -> export ABNT/BibTeX/APA references
- `paper-ops matrix <query>` -> export a literature matrix
- `paper-ops draft <query> --section <section> --question <focus>` -> draft a sourced section from indexed evidence
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
