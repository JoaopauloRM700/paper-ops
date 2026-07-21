# Mode: embed

Use when the user wants semantic retrieval over an indexed saved search query.

Behavior:

- ensure the local RAG index exists for the query
- generate one embedding per indexed chunk
- store vectors in the local SQLite `embeddings` table
- skip unchanged chunk embeddings unless `--refresh-embeddings` is provided

Inputs:

- saved search query
- optional `--embedding-provider`
- optional `--embedding-model`
- optional `--refresh-embeddings`
- optional `--ocr`
