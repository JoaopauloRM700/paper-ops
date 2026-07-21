# OCR and Semantic Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OCR coverage for scanned PDFs and semantic/hybrid retrieval so `paper-ops` can answer questions over more downloaded articles with better evidence recall.

**Architecture:** Keep SQLite as the operational source of truth. OCR becomes an optional text acquisition stage that feeds the existing `documents` and `chunks` pipeline. Semantic retrieval adds embeddings beside the existing FTS/BM25 index, then combines lexical and semantic rankings with Reciprocal Rank Fusion so current citation/evidence behavior keeps working.

**Tech Stack:** Node.js ESM, `better-sqlite3`, existing `pdf-parse` path, optional external `ocrmypdf` CLI for PDF OCR, optional embedding provider via HTTP API, SQLite JSON vector storage for V1, optional `sqlite-vec` acceleration in a later performance pass.

## Global Constraints

- Preserve existing saved search artifacts in `data/*`, `reports/*`, and `output/*`.
- Keep the default database path as `data/paper-ops.sqlite`.
- Keep BM25/FTS retrieval available as a fallback and as part of hybrid retrieval.
- Do not require OCR binaries or embedding API keys for the normal test suite.
- Use fixture and fake providers in tests; integration checks for real OCR/embedding providers must be opt-in.
- Keep OCR and embedding artifacts reproducible from saved `output/*.json`, `output/pdfs/*`, and extracted text directories.
- OCR for PDFs is opt-in at first: `--ocr` or `paper-ops ocr <query>`.
- Semantic retrieval is opt-in at first: `--retrieval semantic|hybrid`; default can move to `hybrid` after evaluation passes.

---

## File Structure

- Modify: `package.json`
  - Add optional dependency only if the chosen embedding client requires it. Prefer built-in `fetch` for provider calls in V1.
- Modify: `doctor.mjs`
  - Add OCR availability checks and embedding provider configuration checks.
- Modify: `paper-ops.mjs`
  - Add `ocr` and `embed` commands.
  - Add `--ocr`, `--retrieval`, `--embed`, and `--refresh-embeddings` routing to existing commands.
- Modify: `src/lib/cli.mjs`
  - Parse the new commands and flags.
- Modify: `src/lib/db/schema.mjs`
  - Add idempotent schema migrations for OCR runs, embedding metadata, and extra embedding columns.
- Modify: `src/lib/db/database.mjs`
  - Keep the same database open behavior; no public API change expected.
- Modify: `src/lib/pdf-extractor.mjs`
  - Export a typed scanned/too-short PDF error helper so OCR fallback can distinguish unreadable PDFs from ordinary failures.
- Modify: `src/lib/article-texts.mjs`
  - Add OCR fallback when native PDF text extraction is too short and OCR is enabled.
- Create: `src/lib/ocr/engine.mjs`
  - Shared OCR engine interface and availability checks.
- Create: `src/lib/ocr/ocrmypdf.mjs`
  - `ocrmypdf` CLI adapter.
- Create: `src/lib/ocr/workflow.mjs`
  - Query-level OCR orchestration and artifact writing.
- Create: `src/lib/rag/embeddings/provider.mjs`
  - Embedding provider interface, deterministic test provider, and provider factory.
- Create: `src/lib/rag/embeddings/openai-provider.mjs`
  - HTTP embedding provider implementation for compatible embedding APIs.
- Create: `src/lib/rag/embeddings/indexer.mjs`
  - Chunk embedding generation and persistence.
- Create: `src/lib/rag/semantic-retriever.mjs`
  - Semantic top-k retrieval using stored vectors.
- Create: `src/lib/rag/hybrid-retriever.mjs`
  - BM25 plus semantic rank fusion.
- Modify: `src/lib/rag/retriever.mjs`
  - Keep BM25 path and export helpers needed by hybrid retrieval.
- Modify: `src/lib/rag/answerer.mjs`
  - Accept retrieval mode and embed-on-demand options.
- Modify: `src/lib/rag/evidence.mjs`
  - Accept retrieval mode and embed-on-demand options.
- Modify: `src/lib/rag/indexer.mjs`
  - Trigger OCR and embeddings when requested.
- Modify: `src/lib/terminal-ui.mjs`
  - Render OCR, embedding, and retrieval-mode summaries.
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `GEMINI.md`, `AGENTS.md`
  - Document OCR and semantic retrieval commands.
- Modify: `docs/session-history/2026-04-17-academic-paper-search.md`
  - Record the architecture decision.
- Create: `tests/ocr-engine.test.mjs`
- Create: `tests/ocr-workflow.test.mjs`
- Create: `tests/semantic-embeddings.test.mjs`
- Create: `tests/semantic-retriever.test.mjs`
- Create: `tests/hybrid-retriever.test.mjs`
- Modify: `tests/cli-surface.test.mjs`
- Modify: `tests/rag-answer.test.mjs`
- Modify: `tests/rag-index.test.mjs`

---

### Task 1: Schema Support for OCR and Embeddings

**Files:**
- Modify: `src/lib/db/schema.mjs`
- Test: `tests/db-schema.test.mjs`

**Interfaces:**
- Consumes: `initializePaperOpsSchema(db)`
- Produces:
  - table `ocr_runs`
  - extra embedding metadata columns on `embeddings`
  - optional table `embedding_runs`

- [ ] **Step 1: Write the failing schema test**

Add these assertions to `tests/db-schema.test.mjs`:

```js
assert.ok(tables.includes('ocr_runs'));
assert.ok(tables.includes('embedding_runs'));

const embeddingColumns = db.prepare('PRAGMA table_info(embeddings)').all().map((row) => row.name);
assert.ok(embeddingColumns.includes('dimension'));
assert.ok(embeddingColumns.includes('text_hash'));
assert.ok(embeddingColumns.includes('updated_at'));
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm.cmd test -- tests/db-schema.test.mjs
```

Expected: failure because `ocr_runs`, `embedding_runs`, or new columns do not exist.

- [ ] **Step 3: Add idempotent migrations**

Update `src/lib/db/schema.mjs` so `initializePaperOpsSchema(db)` still executes the current `CREATE TABLE IF NOT EXISTS` SQL, then runs guarded `ALTER TABLE` statements:

```js
function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = tableColumns(db, tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
```

Add SQL:

```sql
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
```

Add columns to `embeddings`:

```js
addColumnIfMissing(db, 'embeddings', 'dimension', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing(db, 'embeddings', 'text_hash', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing(db, 'embeddings', 'updated_at', "TEXT NOT NULL DEFAULT ''");
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm.cmd test -- tests/db-schema.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.mjs tests/db-schema.test.mjs
git commit -m "feat: add OCR and embedding schema"
```

---

### Task 2: OCR Engine Adapter

**Files:**
- Create: `src/lib/ocr/engine.mjs`
- Create: `src/lib/ocr/ocrmypdf.mjs`
- Test: `tests/ocr-engine.test.mjs`

**Interfaces:**
- Produces:
  - `checkOcrEngineAvailability({ commandRunner, command })`
  - `runOcrForPdf({ inputPdfPath, outputPdfPath, language, commandRunner })`
  - `createOcrRunId(articleId, now)`

- [ ] **Step 1: Write the failing OCR adapter test**

Create `tests/ocr-engine.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOcrForPdf, checkOcrEngineAvailability } from '../src/lib/ocr/ocrmypdf.mjs';

test('checkOcrEngineAvailability reports available ocrmypdf command', async () => {
  const result = await checkOcrEngineAvailability({
    commandRunner: async () => ({ code: 0, stdout: 'ocrmypdf 17.8.1', stderr: '' }),
  });

  assert.deepEqual(result, {
    available: true,
    engine: 'ocrmypdf',
    version: 'ocrmypdf 17.8.1',
    error: '',
  });
});

test('runOcrForPdf builds the expected ocrmypdf command', async () => {
  const calls = [];
  await runOcrForPdf({
    inputPdfPath: 'input.pdf',
    outputPdfPath: 'output.pdf',
    language: 'por+eng',
    commandRunner: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(calls[0].command, 'ocrmypdf');
  assert.deepEqual(calls[0].args, [
    '--skip-text',
    '--rotate-pages',
    '--deskew',
    '--output-type',
    'pdf',
    '-l',
    'por+eng',
    'input.pdf',
    'output.pdf',
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm.cmd test -- tests/ocr-engine.test.mjs
```

Expected: fail because OCR modules do not exist.

- [ ] **Step 3: Implement the OCR adapter**

Create `src/lib/ocr/engine.mjs`:

```js
import { spawn } from 'node:child_process';

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function createOcrRunId(articleId, now = new Date()) {
  return `ocr-${String(articleId).replace(/[^a-z0-9_-]+/gi, '-')}-${now.toISOString().replace(/[:.]/g, '-')}`;
}
```

Create `src/lib/ocr/ocrmypdf.mjs`:

```js
import { runCommand } from './engine.mjs';

export async function checkOcrEngineAvailability({
  command = 'ocrmypdf',
  commandRunner = runCommand,
} = {}) {
  const result = await commandRunner(command, ['--version']);
  if (result.code !== 0) {
    return {
      available: false,
      engine: 'ocrmypdf',
      version: '',
      error: result.stderr || result.stdout || 'ocrmypdf command failed',
    };
  }

  return {
    available: true,
    engine: 'ocrmypdf',
    version: String(result.stdout || result.stderr).trim(),
    error: '',
  };
}

export async function runOcrForPdf({
  inputPdfPath,
  outputPdfPath,
  language = 'eng',
  command = 'ocrmypdf',
  commandRunner = runCommand,
} = {}) {
  const args = [
    '--skip-text',
    '--rotate-pages',
    '--deskew',
    '--output-type',
    'pdf',
    '-l',
    language,
    inputPdfPath,
    outputPdfPath,
  ];
  const result = await commandRunner(command, args);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'ocrmypdf failed');
  }
  return { outputPdfPath };
}
```

- [ ] **Step 4: Run the OCR adapter tests**

Run:

```bash
npm.cmd test -- tests/ocr-engine.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ocr/engine.mjs src/lib/ocr/ocrmypdf.mjs tests/ocr-engine.test.mjs
git commit -m "feat: add OCR engine adapter"
```

---

### Task 3: OCR Workflow for Saved Queries

**Files:**
- Create: `src/lib/ocr/workflow.mjs`
- Modify: `src/lib/article-texts.mjs`
- Modify: `src/lib/pdf-extractor.mjs`
- Test: `tests/ocr-workflow.test.mjs`

**Interfaces:**
- Consumes:
  - `resolveSavedQueryRecords(projectRoot, query)`
  - `buildArticleArtifactId(record)`
  - `extractTextFromPdfFile(pdfPath)`
  - `runOcrForPdf(...)`
- Produces:
  - `ocrQueryPdfs({ projectRoot, query, language, force, now, ocrRunner, extractTextImpl })`
  - OCR artifacts in `output/ocr-pdfs/*.pdf` and `output/ocr-text/*.txt`

- [ ] **Step 1: Write the failing OCR workflow test**

Create a test project with one saved record and one fake PDF file. The OCR runner should write an OCR PDF, and the fake extractor should return page-marked text.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ocrQueryPdfs } from '../src/lib/ocr/workflow.mjs';

test('ocrQueryPdfs writes OCR text artifacts and summary rows', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-ocr-'));
  const query = '"scanned pdf" AND rag';
  mkdirSync(join(projectRoot, 'output', 'pdfs'), { recursive: true });

  writeFileSync(join(projectRoot, 'output', 'saved-run.json'), JSON.stringify({
    query,
    generatedAt: '2026-07-21T10:00:00.000Z',
    summary: {},
    records: [{
      source: 'scopus',
      source_id: 'SCAN-1',
      title: 'Scanned Evidence for RAG',
      authors: ['Ada Lovelace'],
      year: 2026,
      venue: 'Journal of OCR',
      doi: '10.1000/scanned',
      url: 'https://example.org/scanned',
      abstract: '',
      pdf_available: true,
      pdf_url: 'https://example.org/scanned.pdf',
      matched_query: query,
      retrieved_at: '2026-07-21T10:00:00.000Z',
    }],
  }), 'utf8');

  writeFileSync(join(projectRoot, 'output', 'pdfs', 'doi-10-1000-scanned.pdf'), '%PDF- fake scanned pdf');

  const result = await ocrQueryPdfs({
    projectRoot,
    query,
    language: 'por+eng',
    now: new Date('2026-07-21T12:00:00.000Z'),
    ocrRunner: async ({ outputPdfPath }) => {
      writeFileSync(outputPdfPath, '%PDF- fake ocr pdf');
      return { outputPdfPath };
    },
    extractTextImpl: async () => '--- Page 1 ---\nOCR recovered text for semantic retrieval.',
  });

  assert.equal(result.summary.ocrSucceeded, 1);
  assert.equal(result.summary.ocrFailed, 0);
  assert.ok(existsSync(join(projectRoot, 'output', 'ocr-text', 'doi-10-1000-scanned.txt')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm.cmd test -- tests/ocr-workflow.test.mjs
```

Expected: fail because `ocrQueryPdfs` does not exist.

- [ ] **Step 3: Implement query-level OCR workflow**

Create `src/lib/ocr/workflow.mjs` with:

```js
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildArticleArtifactId, resolveSavedQueryRecords, slugify } from '../article-texts.mjs';
import { extractTextFromPdfFile } from '../pdf-extractor.mjs';
import { createOcrRunId } from './engine.mjs';
import { runOcrForPdf } from './ocrmypdf.mjs';

export async function ocrQueryPdfs({
  projectRoot,
  query,
  language = process.env.PAPER_OPS_OCR_LANG || 'eng',
  force = false,
  now = new Date(),
  ocrRunner = runOcrForPdf,
  extractTextImpl = extractTextFromPdfFile,
} = {}) {
  const recordSet = resolveSavedQueryRecords(projectRoot, query);
  const ocrPdfDir = join(projectRoot, 'output', 'ocr-pdfs');
  const ocrTextDir = join(projectRoot, 'output', 'ocr-text');
  const reportDir = join(projectRoot, 'reports', 'ocr', slugify(recordSet.queryKey, 64));
  mkdirSync(ocrPdfDir, { recursive: true });
  mkdirSync(ocrTextDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const rows = [];
  const summary = { ocrSucceeded: 0, ocrSkipped: 0, ocrFailed: 0 };

  for (const record of recordSet.records) {
    const articleId = buildArticleArtifactId(record);
    const inputPdfPath = join(projectRoot, 'output', 'pdfs', `${articleId}.pdf`);
    const outputPdfPath = join(ocrPdfDir, `${articleId}.pdf`);
    const outputTextPath = join(ocrTextDir, `${articleId}.txt`);
    const ocrRunId = createOcrRunId(articleId, now);

    if (!existsSync(inputPdfPath)) {
      summary.ocrSkipped += 1;
      rows.push({ ocrRunId, articleId, status: 'skipped', error: 'PDF artifact not found' });
      continue;
    }

    if (!force && existsSync(outputTextPath)) {
      summary.ocrSkipped += 1;
      rows.push({ ocrRunId, articleId, status: 'cached', outputTextPath });
      continue;
    }

    try {
      await ocrRunner({ inputPdfPath, outputPdfPath, language });
      const text = await extractTextImpl(outputPdfPath, { record, articleId });
      writeFileSync(outputTextPath, text, 'utf8');
      summary.ocrSucceeded += 1;
      rows.push({ ocrRunId, articleId, status: 'ocr_extracted', inputPdfPath, outputPdfPath, outputTextPath });
    } catch (error) {
      summary.ocrFailed += 1;
      rows.push({ ocrRunId, articleId, status: 'failed', inputPdfPath, outputPdfPath, outputTextPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { query: recordSet.query, queryKey: recordSet.queryKey, language, summary, rows };
}
```

- [ ] **Step 4: Run OCR workflow tests**

Run:

```bash
npm.cmd test -- tests/ocr-workflow.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ocr/workflow.mjs tests/ocr-workflow.test.mjs
git commit -m "feat: add query OCR workflow"
```

---

### Task 4: OCR Fallback Inside RAG Indexing

**Files:**
- Modify: `src/lib/article-texts.mjs`
- Modify: `src/lib/rag/indexer.mjs`
- Modify: `paper-ops.mjs`
- Modify: `src/lib/cli.mjs`
- Test: `tests/rag-index.test.mjs`
- Test: `tests/cli-surface.test.mjs`

**Interfaces:**
- Consumes: `ocrQueryPdfs(...)`
- Produces:
  - `indexQueryForRag({ ..., ocr: true, ocrLanguage })`
  - CLI flag `paper-ops index "<query>" --ocr --ocr-lang por+eng`

- [ ] **Step 1: Write failing tests**

Add to `tests/cli-surface.test.mjs`:

```js
assert.deepEqual(routeCliInput(['index', '"scan"', '--ocr', '--ocr-lang', 'por+eng']), {
  mode: 'index',
  query: '"scan"',
  flags: {
    ocr: true,
    ocrLang: 'por+eng',
  },
});
```

Add to `tests/rag-index.test.mjs` a case where cached `output/ocr-text/<article-id>.txt` is preferred when `ocr: true`.

```js
assert.equal(document.text_source, 'ocr_pdf');
assert.match(hits[0].text, /OCR recovered text/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/cli-surface.test.mjs tests/rag-index.test.mjs
```

Expected: fail because OCR flags and OCR text preference are missing.

- [ ] **Step 3: Add CLI routing**

In `src/lib/cli.mjs`, parse:

```js
if (token === '--ocr') {
  flags.ocr = true;
  continue;
}

if (token === '--ocr-lang') {
  flags.ocrLang = argv[index + 1] ?? '';
  index += 1;
  continue;
}
```

- [ ] **Step 4: Prefer OCR text when enabled**

In `src/lib/article-texts.mjs`, add an optional `ocr` flag to `ensureQueryArticleTexts`. Before falling back to abstract, check:

```js
const ocrTextPath = join(projectRoot, 'output', 'ocr-text', `${articleId}.txt`);
if (ocr && existsSync(ocrTextPath)) {
  return {
    text: readFileSync(ocrTextPath, 'utf8'),
    textPath: ocrTextPath,
    textSource: 'ocr_pdf',
    pdfPath: join(projectRoot, 'output', 'ocr-pdfs', `${articleId}.pdf`),
    status: 'ocr_extracted',
    error: '',
  };
}
```

- [ ] **Step 5: Thread OCR options through indexer**

In `src/lib/rag/indexer.mjs`, accept `ocr = false` and `ocrLanguage = 'eng'`. When `ocr` is true, run `ocrQueryPdfs` before `ensureQueryArticleTexts`, then pass `ocr: true`.

- [ ] **Step 6: Wire CLI options in `paper-ops.mjs`**

Pass:

```js
ocr: routed.flags.ocr,
ocrLanguage: routed.flags.ocrLang || process.env.PAPER_OPS_OCR_LANG || 'eng',
```

to `indexQueryForRag` and `answerQueryWithRag`.

- [ ] **Step 7: Run tests**

Run:

```bash
npm.cmd test -- tests/cli-surface.test.mjs tests/rag-index.test.mjs
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/article-texts.mjs src/lib/rag/indexer.mjs src/lib/cli.mjs paper-ops.mjs tests/cli-surface.test.mjs tests/rag-index.test.mjs
git commit -m "feat: use OCR text in RAG indexing"
```

---

### Task 5: Embedding Provider Abstraction

**Files:**
- Create: `src/lib/rag/embeddings/provider.mjs`
- Create: `src/lib/rag/embeddings/openai-provider.mjs`
- Test: `tests/semantic-embeddings.test.mjs`

**Interfaces:**
- Produces:
  - `createEmbeddingProvider({ provider, model, apiKey, fetchImpl })`
  - provider method `embedTexts(texts: string[]): Promise<{ vectors: number[][], model: string, dimension: number }>`
  - deterministic provider `provider: 'fixture'` for tests

- [ ] **Step 1: Write failing embedding provider tests**

Create `tests/semantic-embeddings.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingProvider } from '../src/lib/rag/embeddings/provider.mjs';

test('fixture embedding provider returns stable normalized vectors', async () => {
  const provider = createEmbeddingProvider({ provider: 'fixture', model: 'fixture-8' });
  const result = await provider.embedTexts(['retrieval augmented generation', 'screening studies']);

  assert.equal(result.model, 'fixture-8');
  assert.equal(result.dimension, 8);
  assert.equal(result.vectors.length, 2);
  assert.equal(result.vectors[0].length, 8);
});

test('openai-compatible provider sends embeddings request', async () => {
  const calls = [];
  const provider = createEmbeddingProvider({
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.embedTexts(['academic evidence']);
  assert.equal(result.dimension, 3);
  assert.deepEqual(result.vectors[0], [0.1, 0.2, 0.3]);
  assert.match(calls[0].url, /\/v1\/embeddings$/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/semantic-embeddings.test.mjs
```

Expected: fail because provider modules do not exist.

- [ ] **Step 3: Implement fixture and provider factory**

In `src/lib/rag/embeddings/provider.mjs`, implement deterministic vectors by hashing tokens into a fixed-size array and L2-normalizing.

- [ ] **Step 4: Implement OpenAI-compatible provider**

In `src/lib/rag/embeddings/openai-provider.mjs`, use `fetchImpl`:

```js
const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ model, input: texts }),
});
```

Throw an error on non-2xx responses with the response body.

- [ ] **Step 5: Run embedding provider tests**

Run:

```bash
npm.cmd test -- tests/semantic-embeddings.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rag/embeddings/provider.mjs src/lib/rag/embeddings/openai-provider.mjs tests/semantic-embeddings.test.mjs
git commit -m "feat: add embedding provider abstraction"
```

---

### Task 6: Embedding Indexer

**Files:**
- Create: `src/lib/rag/embeddings/indexer.mjs`
- Modify: `src/lib/rag/indexer.mjs`
- Test: `tests/semantic-embeddings.test.mjs`

**Interfaces:**
- Consumes:
  - `createEmbeddingProvider(...)`
  - table `chunks`
  - table `embeddings`
- Produces:
  - `embedQueryChunks({ projectRoot, query, provider, model, refreshEmbeddings, databasePath })`

- [ ] **Step 1: Write failing embedding indexer test**

Add a test that creates one indexed query, runs `embedQueryChunks` with `provider: 'fixture'`, and asserts embeddings are stored for each chunk.

```js
const count = db.prepare('SELECT COUNT(*) AS count FROM embeddings').get().count;
assert.equal(count, 2);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/semantic-embeddings.test.mjs
```

Expected: fail because `embedQueryChunks` does not exist.

- [ ] **Step 3: Implement embedding indexer**

Implement:

```js
export async function embedQueryChunks({
  projectRoot,
  query,
  provider = 'fixture',
  model = 'fixture-8',
  refreshEmbeddings = false,
  databasePath,
  embeddingProvider,
} = {}) {
  // open DB, load chunks for query, skip unchanged chunk text_hash unless refreshEmbeddings
  // batch chunk.text values through provider.embedTexts()
  // insert or replace rows into embeddings
}
```

Use SHA-256 of chunk text as `text_hash`. Store `vector_json` as `JSON.stringify(vector)`.

- [ ] **Step 4: Run embedding tests**

Run:

```bash
npm.cmd test -- tests/semantic-embeddings.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rag/embeddings/indexer.mjs src/lib/rag/indexer.mjs tests/semantic-embeddings.test.mjs
git commit -m "feat: index chunk embeddings"
```

---

### Task 7: Semantic Retriever

**Files:**
- Create: `src/lib/rag/semantic-retriever.mjs`
- Test: `tests/semantic-retriever.test.mjs`

**Interfaces:**
- Consumes:
  - stored `embeddings`
  - `articles`
  - `chunks`
  - embedding provider `embedTexts([question])`
- Produces:
  - `retrieveSemanticChunks({ db, query, question, topK, embeddingProvider, provider, model })`

- [ ] **Step 1: Write failing semantic retriever test**

Create a fixture where the lexical wording differs but the fixture embedding provider ranks the intended chunk first.

```js
const hits = await retrieveSemanticChunks({
  db,
  query,
  question: 'How are studies selected?',
  topK: 1,
  embeddingProvider: createEmbeddingProvider({ provider: 'fixture', model: 'fixture-8' }),
});

assert.match(hits[0].text, /screening criteria/);
assert.equal(hits[0].retrievalMode, 'semantic');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/semantic-retriever.test.mjs
```

Expected: fail because semantic retriever does not exist.

- [ ] **Step 3: Implement cosine/dot similarity retriever**

Implement:

```js
function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}
```

Load embeddings for the query/model, compute similarity with the query vector, sort descending, and map rows to the same chunk shape returned by `retrieveEvidenceChunks`.

- [ ] **Step 4: Run semantic retriever tests**

Run:

```bash
npm.cmd test -- tests/semantic-retriever.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rag/semantic-retriever.mjs tests/semantic-retriever.test.mjs
git commit -m "feat: add semantic chunk retrieval"
```

---

### Task 8: Hybrid Retrieval with Rank Fusion

**Files:**
- Create: `src/lib/rag/hybrid-retriever.mjs`
- Modify: `src/lib/rag/retriever.mjs`
- Test: `tests/hybrid-retriever.test.mjs`

**Interfaces:**
- Consumes:
  - `retrieveEvidenceChunks(...)`
  - `retrieveSemanticChunks(...)`
- Produces:
  - `retrieveHybridChunks({ db, query, question, topK, semanticTopK, bm25TopK, embeddingProvider })`

- [ ] **Step 1: Write failing hybrid retriever test**

Assert that one lexical-only hit and one semantic-only hit both survive fusion:

```js
const hits = await retrieveHybridChunks({ db, query, question, topK: 2, embeddingProvider });
assert.equal(hits.length, 2);
assert.ok(hits.some((hit) => hit.retrievalSources.includes('bm25')));
assert.ok(hits.some((hit) => hit.retrievalSources.includes('semantic')));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd test -- tests/hybrid-retriever.test.mjs
```

Expected: fail because hybrid retriever does not exist.

- [ ] **Step 3: Implement Reciprocal Rank Fusion**

Use:

```js
function rrfScore(rank, k = 60) {
  return 1 / (k + rank + 1);
}
```

Merge by `chunkId`, sum BM25 and semantic RRF scores, keep source labels, sort descending by fused score.

- [ ] **Step 4: Run hybrid retriever tests**

Run:

```bash
npm.cmd test -- tests/hybrid-retriever.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rag/hybrid-retriever.mjs src/lib/rag/retriever.mjs tests/hybrid-retriever.test.mjs
git commit -m "feat: add hybrid retrieval"
```

---

### Task 9: Wire Semantic Retrieval into Ask and Evidence

**Files:**
- Modify: `src/lib/rag/answerer.mjs`
- Modify: `src/lib/rag/evidence.mjs`
- Modify: `src/lib/rag/indexer.mjs`
- Modify: `paper-ops.mjs`
- Modify: `src/lib/cli.mjs`
- Modify: `src/lib/terminal-ui.mjs`
- Test: `tests/rag-answer.test.mjs`
- Test: `tests/cli-surface.test.mjs`

**Interfaces:**
- Produces:
  - `paper-ops embed "<query>"`
  - `paper-ops ask "<query>" --question "<question>" --retrieval hybrid --embed`
  - `paper-ops evidence "<query>" --question "<question>" --retrieval semantic --embed`

- [ ] **Step 1: Write failing CLI tests**

Add:

```js
assert.deepEqual(routeCliInput(['ask', '"rag"', '--question', 'why?', '--retrieval', 'hybrid', '--embed']), {
  mode: 'ask',
  query: '"rag"',
  flags: {
    question: 'why?',
    retrieval: 'hybrid',
    embed: true,
  },
});
```

- [ ] **Step 2: Write failing answer test**

In `tests/rag-answer.test.mjs`, call `answerQueryWithRag` with `retrieval: 'hybrid'`, `embed: true`, and fixture embedding provider. Assert `result.retrieval.mode === 'hybrid'`.

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm.cmd test -- tests/cli-surface.test.mjs tests/rag-answer.test.mjs
```

Expected: fail because flags and answer path do not support semantic retrieval.

- [ ] **Step 4: Add flags and command**

Parse:

```js
--retrieval bm25|semantic|hybrid
--embed
--refresh-embeddings
--embedding-provider
--embedding-model
```

Add `embed` to `KNOWN_MODES`.

- [ ] **Step 5: Add retrieval selection**

In `answerer.mjs`, replace direct `retrieveEvidenceChunks(...)` with:

```js
if (retrieval === 'semantic') {
  evidenceChunks = await retrieveSemanticChunks(...);
} else if (retrieval === 'hybrid') {
  evidenceChunks = await retrieveHybridChunks(...);
} else {
  evidenceChunks = retrieveEvidenceChunks(...);
}
```

If `embed` is true or semantic/hybrid has no stored vectors, call `embedQueryChunks(...)`.

- [ ] **Step 6: Run tests**

Run:

```bash
npm.cmd test -- tests/cli-surface.test.mjs tests/rag-answer.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rag/answerer.mjs src/lib/rag/evidence.mjs src/lib/rag/indexer.mjs src/lib/cli.mjs paper-ops.mjs src/lib/terminal-ui.mjs tests/rag-answer.test.mjs tests/cli-surface.test.mjs
git commit -m "feat: wire semantic retrieval into RAG commands"
```

---

### Task 10: Doctor, Docs, and Evaluation

**Files:**
- Modify: `doctor.mjs`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SETUP.md`
- Modify: `GEMINI.md`
- Modify: `AGENTS.md`
- Modify: `docs/session-history/2026-04-17-academic-paper-search.md`
- Create: `tests/retrieval-eval.test.mjs`

**Interfaces:**
- Produces:
  - doctor warning for missing OCR engine
  - doctor warning for missing embedding provider config
  - retrieval evaluation fixtures using `precision@k`, `recall@k`, and `mrr`

- [ ] **Step 1: Write failing doctor/eval tests**

Add an evaluation test with three fixture questions and expected chunk IDs:

```js
const metrics = evaluateRetrievalQuality({
  expected: [['chunk-method'], ['chunk-limits'], ['chunk-results']],
  retrieved: [['chunk-method'], ['chunk-limits'], ['chunk-results']],
  k: 1,
});

assert.equal(metrics.precisionAtK, 1);
assert.equal(metrics.recallAtK, 1);
assert.equal(metrics.mrr, 1);
```

- [ ] **Step 2: Implement evaluation helper**

Create a small helper under `src/lib/rag/evaluation.mjs` or keep it local in the test if only used by tests.

- [ ] **Step 3: Add doctor checks**

`doctor.mjs` should:

```text
WARN OCRmyPDF not found; OCR commands will be unavailable until installed.
WARN No embedding provider configured; semantic retrieval requires --embedding-provider fixture/openai or env config.
```

Do not fail doctor when optional OCR/embedding providers are absent.

- [ ] **Step 4: Document commands**

Add examples:

```bash
paper-ops ocr "<query>" --ocr-lang por+eng
paper-ops index "<query>" --ocr --embed --retrieval hybrid
paper-ops embed "<query>" --embedding-provider openai --embedding-model text-embedding-3-small
paper-ops ask "<query>" --question "Quais metodos sao usados?" --retrieval hybrid --embed
paper-ops evidence "<query>" --question "Quais limitacoes aparecem?" --retrieval semantic
```

- [ ] **Step 5: Run full verification**

Run:

```bash
npm.cmd test
node doctor.mjs
node test-all.mjs
```

Expected:

- `npm.cmd test` passes.
- `node doctor.mjs` passes with optional warnings if OCR/embedding providers are absent.
- `node test-all.mjs` passes.

- [ ] **Step 6: Commit**

```bash
git add doctor.mjs README.md docs/ARCHITECTURE.md docs/SETUP.md GEMINI.md AGENTS.md docs/session-history/2026-04-17-academic-paper-search.md tests/retrieval-eval.test.mjs
git commit -m "docs: document OCR and semantic retrieval"
```

---

## Recommended Rollout

1. Merge OCR schema and engine adapter first.
2. Add `paper-ops ocr <query>` as an explicit command before making `--ocr` automatic.
3. Add fixture embeddings and brute-force semantic retrieval before using any real embedding provider.
4. Add hybrid retrieval and keep BM25 fallback.
5. After retrieval evaluation is stable, make `hybrid` the default for `ask` and `evidence`.
6. Consider `sqlite-vec` only after measuring that brute-force JSON vector retrieval is too slow for the user's corpus size.

## Acceptance Criteria

- A scanned PDF can produce `output/ocr-text/<article-id>.txt`.
- `paper-ops index "<query>" --ocr` indexes OCR text instead of failing or falling back to abstract.
- `paper-ops embed "<query>"` stores one embedding per chunk.
- `paper-ops ask "<query>" --question "<question>" --retrieval semantic --embed` answers from semantic hits.
- `paper-ops ask "<query>" --question "<question>" --retrieval hybrid --embed` combines BM25 and semantic hits.
- Evidence rows still include article title, page, DOI/URL, score, and exact chunk text.
- Tests pass without a real OCR binary or a real embedding API key.

## Self-Review

- Spec coverage: OCR, semantic retrieval, hybrid fallback, CLI, schema, tests, docs, and doctor checks are covered.
- Placeholder scan: no implementation step is deferred without an executable task.
- Type consistency: OCR uses `ocrQueryPdfs`, embeddings use `embedQueryChunks`, semantic retrieval uses `retrieveSemanticChunks`, and hybrid retrieval uses `retrieveHybridChunks`.
