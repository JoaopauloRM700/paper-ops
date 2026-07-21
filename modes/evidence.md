# Mode: evidence

Use when the user wants retrieved source passages for a research question without a narrative answer.

Behavior:

- ensure the local RAG index exists for the query
- retrieve top chunks through SQLite FTS/BM25, semantic embeddings, or hybrid fusion
- export JSON and Markdown evidence tables
- include article title, page, DOI, score, and exact chunk text

Inputs:

- saved search query
- `--question "<question>"`
- optional `--top-k <number>`
- optional `--retrieval bm25|semantic|hybrid`
- optional `--embed`
- optional `--refresh-embeddings`
