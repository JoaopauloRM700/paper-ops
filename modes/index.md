# Mode: index

Use when the user wants to build or refresh the local RAG database for a saved search query.

Behavior:

- initialize `data/paper-ops.sqlite`
- reuse saved search exports from `output/*.json`
- reuse cached PDF text from `output/pdf-text/` when available
- prefer cached OCR text from `output/ocr-text/` when `--ocr` is provided
- fall back to saved abstracts when PDF text is unavailable
- chunk text by page and populate SQLite FTS/BM25
- optionally populate semantic embeddings when `--embed` is provided
- store article metadata, documents, chunks, and references

Inputs:

- saved search query
- optional `--refresh-text`
- optional `--refresh-index`
- optional `--ocr`
- optional `--embed`
- optional `--refresh-embeddings`
