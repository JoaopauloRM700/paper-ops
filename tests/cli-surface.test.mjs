import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../paper-ops.mjs';
import { routeCliInput } from '../src/lib/cli.mjs';
import { buildGeminiPrompt } from '../src/lib/gemini-cli.mjs';

const FIXTURE_CONFIG = JSON.stringify(
  {
    defaults: {
      per_source_limit: 5,
      fixture_mode: false,
    },
    sources: {
      scopus: { enabled: true, mode: 'fixture', fixture: 'scopus.json' },
      ieee: { enabled: true, mode: 'fixture', fixture: 'ieee.json' },
      acm: { enabled: true, mode: 'fixture', fixture: 'acm.json' },
      google_scholar: { enabled: false, experimental: true, mode: 'fixture', fixture: 'scholar.json' },
    },
  },
  null,
  2,
);

function createTempProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-cli-'));
  mkdirSync(join(projectRoot, 'config'), { recursive: true });
  writeFileSync(join(projectRoot, 'config', 'sources.yml'), FIXTURE_CONFIG, 'utf8');
  return projectRoot;
}

test('main renders a terminal summary for search mode in addition to saving artifacts', async () => {
  const projectRoot = createTempProjectRoot();
  const lines = [];

  await main(
    ['search', '"systematic review" AND rag', '--fixtures', '--project-root', projectRoot],
    {
      stdout(line) {
        lines.push(line);
      },
    },
  );

  const output = lines.join('\n');
  assert.match(output, /paper-ops search complete/i);
  assert.match(output, /Source coverage/i);
  assert.match(output, /Saved artifacts/i);
  assert.match(output, /PDF/i);
  assert.match(output, /Evidence Mapping with RAG Pipelines/);
});

test('buildGeminiPrompt canonicalizes router requests for Gemini CLI one-shot usage', () => {
  assert.equal(
    buildGeminiPrompt(['search', '"systematic review" AND rag', '--fixtures']),
    'paper-ops search "\\"systematic review\\" AND rag" --fixtures',
  );

  assert.equal(
    buildGeminiPrompt(['("knowledge graph" AND screening)', '--fixtures']),
    'paper-ops search "(\\"knowledge graph\\" AND screening)" --fixtures',
  );

  assert.equal(buildGeminiPrompt(['tracker']), 'paper-ops tracker');
  assert.equal(buildGeminiPrompt(['csv', '"software testing" AND ai']), 'paper-ops csv "\\"software testing\\" AND ai"');
  assert.equal(buildGeminiPrompt(['fetch-pdfs', '"software testing" AND ai']), 'paper-ops fetch-pdfs "\\"software testing\\" AND ai"');
  assert.equal(buildGeminiPrompt(['summarize', '"software testing" AND ai']), 'paper-ops summarize "\\"software testing\\" AND ai"');
  assert.equal(buildGeminiPrompt(['digest', '"software testing" AND ai']), 'paper-ops digest "\\"software testing\\" AND ai"');
  assert.equal(
    buildGeminiPrompt(['ask', '"software testing" AND ai', '--question', 'What evidence supports AI testing?', '--refresh-text']),
    'paper-ops ask "\\"software testing\\" AND ai" --question "What evidence supports AI testing?" --refresh-text',
  );
});

test('routeCliInput recognizes local RAG commands and flags', () => {
  assert.deepEqual(routeCliInput(['db', 'init']), {
    mode: 'db',
    query: 'init',
    flags: {},
  });

  assert.deepEqual(routeCliInput(['index', '"software testing" AND ai', '--refresh-index', '--top-k', '8']), {
    mode: 'index',
    query: '"software testing" AND ai',
    flags: {
      refreshIndex: true,
      topK: 8,
    },
  });

  assert.deepEqual(routeCliInput(['index', '"scan"', '--ocr', '--ocr-lang', 'por+eng']), {
    mode: 'index',
    query: '"scan"',
    flags: {
      ocr: true,
      ocrLang: 'por+eng',
    },
  });

  assert.deepEqual(routeCliInput(['ocr', '"scan"', '--ocr-lang', 'eng', '--force']), {
    mode: 'ocr',
    query: '"scan"',
    flags: {
      ocrLang: 'eng',
      force: true,
    },
  });

  assert.deepEqual(routeCliInput([
    'ask',
    '"rag"',
    '--question',
    'why?',
    '--retrieval',
    'hybrid',
    '--embed',
    '--refresh-embeddings',
    '--embedding-provider',
    'fixture',
    '--embedding-model',
    'fixture-32',
  ]), {
    mode: 'ask',
    query: '"rag"',
    flags: {
      question: 'why?',
      retrieval: 'hybrid',
      embed: true,
      refreshEmbeddings: true,
      embeddingProvider: 'fixture',
      embeddingModel: 'fixture-32',
    },
  });

  assert.equal(
    buildGeminiPrompt(['references', '"software testing" AND ai', '--format', 'bibtex']),
    'paper-ops references "\\"software testing\\" AND ai" --format bibtex',
  );

  assert.equal(
    buildGeminiPrompt(['draft', '"software testing" AND ai', '--section', 'related-work', '--question', 'What evidence supports AI testing?']),
    'paper-ops draft "\\"software testing\\" AND ai" --question "What evidence supports AI testing?" --section related-work',
  );

  assert.equal(
    buildGeminiPrompt(['embed', '"software testing" AND ai', '--embedding-provider', 'fixture', '--embedding-model', 'fixture-32']),
    'paper-ops embed "\\"software testing\\" AND ai" --embedding-provider fixture --embedding-model fixture-32',
  );
});
