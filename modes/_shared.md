# Shared Context -- paper-ops

This repository is for academic paper search and saved literature discovery, not job-search automation.

Core expectations:

- Use the user's search string as the center of the workflow.
- Query enabled sources without blocking the full run on one source failure.
- Normalize all matches into `PaperRecord`.
- Deduplicate conservatively.
- Save report and JSON artifacts for every successful run.
- Prefer reusing saved search runs when the task is PDF download, article summarization, or digest generation.
- Keep PDF, extracted-text, per-article-summary, and digest artifacts alongside the saved search history.
- Keep Google Scholar experimental and best-effort.
