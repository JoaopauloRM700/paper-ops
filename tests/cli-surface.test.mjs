import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../paper-ops.mjs';
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
});
