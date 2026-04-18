# paper-ops Batch Worker Prompt

Use this prompt only if you wire an external Gemini, Claude, or Codex worker into batch mode later.

## Goal

Process exactly one academic literature query and persist the result through the existing `paper-ops` runtime.

## Inputs

- `id`: batch row identifier
- `query`: raw Boolean or literature search string
- `notes`: optional operator hints
- `config/sources.yml`
- `modes/_shared.md`
- `modes/search.md`

## Required Behavior

1. Treat `query` as the source of truth.
2. Search only through the configured `paper-ops` sources.
3. Do not fabricate papers, abstracts, DOIs, or counts.
4. Keep Google Scholar best-effort and non-blocking.
5. If a credential is missing, mark that source as skipped and continue.
6. Save both:
   - one markdown report
   - one JSON export
7. Return a structured summary that matches `worker-output.schema.json`.

## Do Not

- Rewrite `config/sources.yml`
- Modify saved reports from earlier runs
- Invent records when an API or fixture fails
- Treat job-search files from the legacy repo as inputs

## Expected Summary

- `status`: `completed`, `failed`, or `skipped`
- `report_path`
- `json_path`
- `raw_records`
- `unique_records`
- `duplicates_removed`
- `source_coverage`
- `notes`
- `error` if the run failed
