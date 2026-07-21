const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS search_runs (
  query_key TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  matched_files_json TEXT NOT NULL DEFAULT '[]',
  profile_json TEXT,
  generated_at TEXT,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  article_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  year INTEGER,
  venue TEXT,
  doi TEXT,
  url TEXT,
  pdf_path TEXT,
  text_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_run_articles (
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(article_id) ON DELETE CASCADE,
  PRIMARY KEY (query_key, article_id)
);

CREATE TABLE IF NOT EXISTS documents (
  article_id TEXT PRIMARY KEY REFERENCES articles(article_id) ON DELETE CASCADE,
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  text_source TEXT NOT NULL,
  status TEXT NOT NULL,
  text_hash TEXT,
  text_path TEXT,
  character_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(article_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_start TEXT,
  page_end TEXT,
  section TEXT,
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL DEFAULT 0,
  char_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  chunk_id UNINDEXED,
  query_key UNINDEXED,
  article_id UNINDEXED,
  title UNINDEXED,
  text
);

CREATE TABLE IF NOT EXISTS answers (
  answer_id TEXT PRIMARY KEY,
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  query TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  confidence TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  answer_json_path TEXT,
  answer_markdown_path TEXT
);

CREATE TABLE IF NOT EXISTS answer_evidence (
  answer_id TEXT NOT NULL REFERENCES answers(answer_id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(article_id) ON DELETE CASCADE,
  quote TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  page_start TEXT,
  page_end TEXT,
  score REAL,
  PRIMARY KEY (answer_id, chunk_id, quote)
);

CREATE TABLE IF NOT EXISTS "references" (
  article_id TEXT PRIMARY KEY REFERENCES articles(article_id) ON DELETE CASCADE,
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  authors_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  year INTEGER,
  venue TEXT,
  doi TEXT,
  url TEXT,
  abnt TEXT,
  bibtex TEXT,
  apa TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chunk_id, provider, model)
);

CREATE TABLE IF NOT EXISTS ocr_runs (
  ocr_run_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(article_id) ON DELETE CASCADE,
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  language TEXT NOT NULL,
  input_pdf_path TEXT NOT NULL,
  output_pdf_path TEXT,
  output_text_path TEXT,
  status TEXT NOT NULL,
  page_count INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_runs (
  embedding_run_id TEXT PRIMARY KEY,
  query_key TEXT NOT NULL REFERENCES search_runs(query_key) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  status TEXT NOT NULL,
  chunks_total INTEGER NOT NULL DEFAULT 0,
  chunks_embedded INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_query ON chunks(query_key);
CREATE INDEX IF NOT EXISTS idx_chunks_article ON chunks(article_id);
CREATE INDEX IF NOT EXISTS idx_documents_query ON documents(query_key);
CREATE INDEX IF NOT EXISTS idx_references_query ON "references"(query_key);
CREATE INDEX IF NOT EXISTS idx_ocr_runs_query ON ocr_runs(query_key);
CREATE INDEX IF NOT EXISTS idx_embedding_runs_query ON embedding_runs(query_key);
`;

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = tableColumns(db, tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function initializePaperOpsSchema(db) {
  db.exec(SCHEMA_SQL);
  addColumnIfMissing(db, 'embeddings', 'dimension', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'embeddings', 'text_hash', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'embeddings', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  return db;
}
