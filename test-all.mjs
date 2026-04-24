#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { runDoctor } from './doctor.mjs';
import { verifyHistoryLinks } from './verify.mjs';
import { routeCliInput } from './src/lib/cli.mjs';
import { loadSourcesConfig } from './src/lib/config.mjs';
import { normalizePaperRecord, deduplicatePaperRecords } from './src/lib/papers.mjs';
import { runSearchAndPersist } from './src/lib/search-runner.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = new URL('./tests/fixtures/', import.meta.url);

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(message) {
  console.log(`  OK   ${message}`);
  passed += 1;
}

function fail(message) {
  console.log(`  ERR  ${message}`);
  failed += 1;
}

function warn(message) {
  console.log(`  WARN ${message}`);
  warnings += 1;
}

function assert(condition, successMessage, failureMessage) {
  if (condition) {
    pass(successMessage);
  } else {
    fail(failureMessage);
  }
}

function fileExists(relativePath) {
  return existsSync(join(ROOT, relativePath));
}

function readFile(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function commandExists(name) {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(resolver, [name], { stdio: 'ignore' });
  return result.status === 0;
}

function collectFiles(directory, predicate, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    const absolutePath = join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, predicate, relativePath));
    } else if (predicate(relativePath)) {
      files.push(relativePath.replace(/\\/g, '/'));
    }
  }
  return files;
}

console.log('\npaper-ops test suite\n');

console.log('1. Module load checks');
for (const relativePath of [
  'paper-ops.mjs',
  'paper-ops-gemini.mjs',
  'doctor.mjs',
  'verify.mjs',
  ...collectFiles(join(ROOT, 'src'), (path) => path.endsWith('.mjs'), 'src'),
]) {
  try {
    await import(pathToFileURL(join(ROOT, relativePath)).href);
    pass(`${relativePath} imports cleanly`);
  } catch (error) {
    fail(`${relativePath} failed to import: ${error.message}`);
  }
}

console.log('\n2. Required repo files');
for (const relativePath of [
  'README.md',
  'AGENTS.md',
  'GEMINI.md',
  '.env.example',
  'paper-ops-gemini.mjs',
  'config/sources.yml',
  'modes/_shared.md',
  'modes/search.md',
  'modes/pipeline.md',
  'modes/tracker.md',
  'modes/batch.md',
  'plugins/paper-ops/.codex-plugin/plugin.json',
  'plugins/paper-ops/skills/paper-ops/SKILL.md',
  'batch/README.md',
  'batch/batch-input.tsv',
  'batch/batch-runner.sh',
  'batch/batch-prompt.md',
  'batch/worker-output.schema.json',
]) {
  assert(fileExists(relativePath), `Found ${relativePath}`, `Missing ${relativePath}`);
}

console.log('\n3. Public surface regression checks');
const bannedTokens = [
  'career-ops',
  'cv.md',
  'portals.yml',
  'applications.md',
  'job offers',
  'ats-optimized cv',
  'linkedin outreach',
];

for (const relativePath of [
  'README.md',
  'AGENTS.md',
  'GEMINI.md',
  'doctor.mjs',
  'batch/README.md',
  'batch/batch-runner.sh',
  'batch/batch-prompt.md',
  'plugins/paper-ops/.codex-plugin/plugin.json',
  'plugins/paper-ops/skills/paper-ops/SKILL.md',
]) {
  const content = readFile(relativePath).toLowerCase();
  const matches = bannedTokens.filter((token) => {
    if (relativePath === 'README.md' && token === 'career-ops') {
      return false;
    }

    return content.includes(token);
  });
  assert(
    matches.length === 0,
    `${relativePath} is paper-ops specific`,
    `${relativePath} still references stale terms: ${matches.join(', ')}`,
  );
}

assert(
  readFile('README.md').includes('https://github.com/santifer/career-ops'),
  'README.md credits the base career-ops project',
  'README.md is missing the required credit to the base career-ops project',
);

console.log('\n4. Inline runtime checks');
const routedExplicit = routeCliInput(['search', '"systematic review" AND rag']);
assert(
  routedExplicit.mode === 'search' && routedExplicit.query === '"systematic review" AND rag',
  'Explicit CLI routing resolves to search',
  'Explicit CLI routing did not resolve to search',
);

const routedRaw = routeCliInput(['("systematic review" AND rag) AND ieee']);
assert(
  routedRaw.mode === 'search' && routedRaw.query.includes('systematic review'),
  'Raw query routing resolves to search',
  'Raw query routing did not resolve to search',
);

const dedupResult = deduplicatePaperRecords([
  normalizePaperRecord({
    source: 'scopus',
    source_id: 'SCOPUS-1',
    title: 'Evidence Mapping with RAG Pipelines',
    authors: ['Ada Lovelace'],
    year: 2024,
    venue: 'Journal A',
    doi: '10.1000/alpha',
    url: 'https://example.org/a',
    abstract: 'alpha',
    matched_query: 'rag',
    retrieved_at: '2026-04-17T15:00:00.000Z',
  }),
  normalizePaperRecord({
    source: 'ieee',
    source_id: 'IEEE-1',
    title: 'Evidence Mapping with RAG Pipelines',
    authors: ['Ada Lovelace'],
    year: 2024,
    venue: 'Journal B',
    doi: '10.1000/alpha',
    url: 'https://example.org/b',
    abstract: 'alpha duplicate',
    matched_query: 'rag',
    retrieved_at: '2026-04-17T15:00:00.000Z',
  }),
]);

assert(
  dedupResult.uniqueRecords.length === 1 && dedupResult.stats.duplicatesRemoved === 1,
  'Deduplication still prefers DOI matches',
  'Deduplication regression detected',
);

const doctorLines = [];
const doctorResult = await runDoctor({ stdout: (line) => doctorLines.push(line) });
assert(doctorResult.failures === 0, 'doctor.mjs logic passed', 'doctor.mjs logic failed');
if (doctorResult.warnings > 0) {
  warn(`doctor.mjs emitted ${doctorResult.warnings} warning(s): ${doctorLines.filter((line) => line.startsWith('WARN')).join(' | ')}`);
}

const emptyVerify = verifyHistoryLinks(join(tmpdir(), 'paper-ops-no-history-check'), { stdout: () => {} });
assert(emptyVerify.failures === 0, 'verify.mjs handles missing history', 'verify.mjs should not fail when history is absent');

console.log('\n5. Fixture-backed smoke search');
const tempRoot = mkdtempSync(join(tmpdir(), 'paper-ops-suite-'));
mkdirSync(join(tempRoot, 'config'), { recursive: true });
copyFileSync(join(ROOT, 'config', 'sources.yml'), join(tempRoot, 'config', 'sources.yml'));

const smokeConfig = loadSourcesConfig(JSON.parse(readFile('config/sources.yml')));
smokeConfig.defaults.fixture_mode = true;
for (const sourceConfig of Object.values(smokeConfig.sources)) {
  if (sourceConfig.fixture) {
    sourceConfig.mode = 'fixture';
  }
}

const smokeResult = await runSearchAndPersist({
  query: '"systematic review" AND "retrieval augmented generation"',
  config: smokeConfig,
  projectRoot: tempRoot,
  fixtureDir: FIXTURE_DIR,
  now: new Date('2026-04-17T16:00:00.000Z'),
});

assert(
  existsSync(smokeResult.artifacts.markdownReport) &&
    existsSync(smokeResult.artifacts.jsonExport) &&
    existsSync(smokeResult.artifacts.historyIndex),
  'Smoke search produced report, JSON export, and history index',
  'Smoke search did not produce the expected artifacts',
);

const verifyResult = verifyHistoryLinks(tempRoot, { stdout: () => {} });
assert(verifyResult.failures === 0, 'verify.mjs validated generated history links', 'verify.mjs reported broken generated history links');

console.log('\n6. Batch runner checks');
const batchRunner = readFile('batch/batch-runner.sh');
assert(batchRunner.startsWith('#!/usr/bin/env bash'), 'batch-runner has a bash shebang', 'batch-runner is missing its bash shebang');
assert(batchRunner.includes('paper-ops.mjs'), 'batch-runner calls paper-ops.mjs', 'batch-runner no longer calls paper-ops.mjs');
assert(batchRunner.includes('batch-state.tsv'), 'batch-runner tracks state', 'batch-runner no longer tracks state');
if (!commandExists('bash')) {
  warn('bash not found; shell execution was not validated directly');
}

console.log('\n7. Dashboard status');
if (fileExists('dashboard/main.go')) {
  warn('dashboard/ is present but still treated as a deferred transplant, not a verified runtime surface');
} else {
  pass('dashboard/ not present in active repo surface');
}

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('TESTS FAILED');
  process.exit(1);
}

if (warnings > 0) {
  console.log('Tests passed with warnings');
  process.exit(0);
}

console.log('All tests passed');
