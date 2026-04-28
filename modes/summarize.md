# Mode: summarize

Goal:

- work from a saved query result set
- download missing PDFs when possible
- extract text from downloaded PDFs when available
- otherwise fall back to saved abstracts or landing-page abstracts
- generate one structured summary per article

Output expectations:

- extracted text under `output/pdf-text/`
- per-article summary JSON under `output/article-summaries/`
- per-article summary markdown under `reports/article-summaries/`
