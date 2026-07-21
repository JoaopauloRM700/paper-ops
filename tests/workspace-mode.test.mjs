import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../paper-ops.mjs';
import { routeCliInput } from '../src/lib/cli.mjs';
import {
  parseResearchProfile,
  resolveQueryInput,
} from '../src/lib/research-profile.mjs';

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
      scielo: { enabled: false, mode: 'fixture', fixture: 'scielo.json' },
      web_of_science: { enabled: false, mode: 'fixture', fixture: 'web-of-science.json' },
    },
  },
  null,
  2,
);

function createTempProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-workspace-'));
  mkdirSync(join(projectRoot, 'config'), { recursive: true });
  writeFileSync(join(projectRoot, 'config', 'sources.yml'), FIXTURE_CONFIG, 'utf8');
  return projectRoot;
}

function createWorkspace(projectRoot, slug = 'rsl-ai-testing') {
  const workspaceRoot = join(projectRoot, 'workspaces', slug);
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    join(workspaceRoot, 'brief.md'),
    `# Projeto/Pesquisa
- Revisão Sistemática da Literatura sobre Testes Exploratórios Automatizados

# String de busca
- ("software testing" OR "test automation") AND ("artificial intelligence" OR "machine learning")

## Categoria: Assunto 1
### Abordagem / Detalhe
- Agentes que navegam autonomamente
- Crawlers inteligentes

### Palavras-chave
- autonomous UI exploration, intelligent agents testing
- reinforcement learning testing, RL-based exploration
`,
    'utf8',
  );
  return workspaceRoot;
}

test('routeCliInput supports ingest and workspace init commands', () => {
  assert.deepEqual(routeCliInput(['ingest', 'workspaces/rsl-ai-testing']), {
    mode: 'ingest',
    query: 'workspaces/rsl-ai-testing',
    flags: {},
  });

  assert.deepEqual(routeCliInput(['workspace', 'init', 'rsl-ai-testing']), {
    mode: 'workspace-init',
    query: 'rsl-ai-testing',
    flags: {},
  });
});

test('parseResearchProfile recognizes explicit search string and nested topic sections', () => {
  const projectRoot = createTempProjectRoot();
  const workspaceRoot = createWorkspace(projectRoot);
  const profile = parseResearchProfile(join(workspaceRoot, 'brief.md'));

  assert.equal(profile['Projeto/Pesquisa'][0], 'Revisão Sistemática da Literatura sobre Testes Exploratórios Automatizados');
  assert.equal(profile['String de busca'][0], '("software testing" OR "test automation") AND ("artificial intelligence" OR "machine learning")');
  assert.deepEqual(profile['Categoria: Assunto 1'], []);
  assert.deepEqual(profile['Abordagem / Detalhe'], ['Agentes que navegam autonomamente', 'Crawlers inteligentes']);
  assert.deepEqual(profile['Palavras-chave'], [
    'autonomous UI exploration, intelligent agents testing',
    'reinforcement learning testing, RL-based exploration',
  ]);
});

test('resolveQueryInput accepts workspace directories and returns workspace metadata', () => {
  const projectRoot = createTempProjectRoot();
  const workspaceRoot = createWorkspace(projectRoot);

  const resolved = resolveQueryInput(workspaceRoot, projectRoot);

  assert.equal(resolved.isWorkspace, true);
  assert.equal(resolved.workspace.root, workspaceRoot);
  assert.equal(resolved.workspace.briefPath, join(workspaceRoot, 'brief.md'));
  assert.equal(
    resolved.query,
    '("software testing" OR "test automation") AND ("artificial intelligence" OR "machine learning")',
  );
});

test('workspace init creates the canonical workspace structure with a brief template', async () => {
  const projectRoot = createTempProjectRoot();
  const lines = [];

  const result = await main(
    ['workspace', 'init', 'agentic-testing-rsl', '--project-root', projectRoot],
    {
      stdout(line) {
        lines.push(line);
      },
    },
  );

  const workspaceRoot = join(projectRoot, 'workspaces', 'agentic-testing-rsl');
  assert.equal(result.mode, 'workspace-init');
  assert.ok(existsSync(join(workspaceRoot, 'brief.md')));
  assert.ok(existsSync(join(workspaceRoot, 'data')));
  assert.ok(existsSync(join(workspaceRoot, 'output')));
  assert.ok(existsSync(join(workspaceRoot, 'reports')));
  assert.match(readFileSync(join(workspaceRoot, 'brief.md'), 'utf8'), /String de busca|Search String/);
  assert.match(lines.join('\n'), /workspace init complete/i);
});

test('search on a workspace directory saves run artifacts inside workspace-specific folders', async () => {
  const projectRoot = createTempProjectRoot();
  const workspaceRoot = createWorkspace(projectRoot);
  const lines = [];

  const result = await main(
    ['search', workspaceRoot, '--fixtures', '--project-root', projectRoot],
    {
      stdout(line) {
        lines.push(line);
      },
    },
  );

  assert.ok(result.artifacts.markdownReport.includes(join('reports', 'search-runs')));
  assert.ok(result.artifacts.jsonExport.includes(join('output', 'search-runs')));
  assert.ok(result.artifacts.historyIndex.includes(join('data', 'search-history.md')));
  assert.match(lines.join('\n'), /paper-ops search complete/i);
});
