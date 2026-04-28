# Mode: fetch-pdfs

Goal:

- read saved search exports for one query
- download accessible PDFs only
- keep downloads cached by article identity so reruns do not re-fetch the same file

Output expectations:

- terminal summary of downloaded, cached, skipped, and failed PDFs
- saved PDF artifacts under `output/pdfs/`
