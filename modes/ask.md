# Mode: ask

Use when the user wants to answer a targeted question from saved paper results through the local RAG database.

Behavior:

- create/update `data/paper-ops.sqlite` when indexed chunks are missing
- extract or reuse cached PDF text and abstract fallbacks
- retrieve top chunks through SQLite FTS/BM25, semantic embeddings, or hybrid fusion
- answer only from retrieved evidence
- validate returned quotes against retrieved chunks
- save answer/evidence rows in SQLite
- save answer JSON under `output/rag/<query-id>/answers/`
- save answer markdown under `reports/rag/<query-id>/answers/`

Inputs:

- saved search query
- `--question "<question>"`
- optional `--refresh-text` to regenerate cached extracted text before answering
- optional `--refresh-index` to rebuild indexed chunks
- optional `--top-k <number>` to tune retrieval breadth
- optional `--ocr` to use OCR text during indexing
- optional `--retrieval bm25|semantic|hybrid`
- optional `--embed`
- optional `--refresh-embeddings`
