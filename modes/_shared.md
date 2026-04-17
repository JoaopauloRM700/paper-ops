# Shared Context -- paper-ops

This repository is for academic paper search and saved literature discovery, not job-search automation.

Core expectations:

- Use the user’s search string as the center of the workflow
- Query enabled sources without blocking the full run on one source failure
- Normalize all matches into `PaperRecord`
- Deduplicate conservatively
- Save report and JSON artifacts for every successful run
- Keep Google Scholar experimental and best-effort
