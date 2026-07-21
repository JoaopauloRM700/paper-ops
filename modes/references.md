# Mode: references

Use when the user wants formatted references for articles in a saved query.

Behavior:

- ensure articles are indexed in the local SQLite database
- export ABNT, BibTeX, APA, or all formats
- write reference artifacts under `reports/rag/<query-id>/references/`

Inputs:

- saved search query
- optional `--format abnt|bibtex|apa|all`
