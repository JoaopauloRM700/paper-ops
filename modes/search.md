# Mode: search

Run a multi-source paper search from a raw query string.

Workflow:

1. Load `config/sources.yml`
2. Query enabled sources
3. Normalize to `PaperRecord`
4. Deduplicate
5. Save markdown + JSON artifacts
6. Update `data/search-history.md`
7. Summarize source coverage, top matches, PDF availability, and artifact paths in terminal output
