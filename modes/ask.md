# Mode: ask

Use when the user wants to answer a targeted question from saved paper results.

Behavior:

- download missing PDFs when possible
- extract or reuse cached PDF text
- fall back to saved abstracts or landing-page abstracts when PDF text is unavailable
- answer only from the available evidence
- save answer JSON under `output/answers/`
- save answer markdown under `reports/answers/`

Inputs:

- saved search query
- `--question "<question>"`
- optional `--refresh-text` to regenerate cached extracted text before answering
