import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  answerWorkspaceQuestion,
  ingestWorkspaceCorpus,
} from '../src/lib/article-digest.mjs';

const QUERY = '"software testing" AND ai';

function buildPdfResponse(body = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF') {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
    },
  });
}

function createWorkspaceRoot() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'paper-ops-corpus-'));
  mkdirSync(join(workspaceRoot, 'output', 'search-runs'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'data'), { recursive: true });
  writeFileSync(
    join(workspaceRoot, 'brief.md'),
    `# Projeto/Pesquisa
- RSL sobre testes automatizados

# String de busca
- ${QUERY}
`,
    'utf8',
  );

  writeFileSync(
    join(workspaceRoot, 'output', 'search-runs', 'saved-run.json'),
    JSON.stringify(
      {
        query: QUERY,
        generatedAt: '2026-06-17T10:00:00.000Z',
        summary: {
          totalRawRecords: 2,
          duplicatesRemoved: 0,
          uniqueRecords: 2,
          removedByRule: {},
          sourceCoverage: {},
        },
        records: [
          {
            source: 'scopus',
            source_id: 'SCOPUS-ALPHA',
            title: 'AI-Augmented Software Testing Pipelines',
            authors: ['Ada Lovelace'],
            year: 2025,
            venue: 'Journal of AI Testing',
            doi: '10.1000/alpha',
            url: 'https://example.org/alpha',
            abstract: 'Saved abstract for alpha.',
            pdf_available: true,
            pdf_url: 'https://example.org/alpha.pdf',
            matched_query: QUERY,
            retrieved_at: '2026-06-17T10:00:00.000Z',
          },
          {
            source: 'google_scholar',
            source_id: 'SCHOLAR-BETA',
            title: 'Manual Regression Testing on Legacy Platforms',
            authors: ['Grace Hopper'],
            year: 2022,
            venue: 'Legacy QA Review',
            doi: '',
            url: 'https://example.org/beta',
            abstract: 'This article compares human exploratory testing and autonomous agents in legacy web systems.',
            pdf_available: null,
            pdf_url: '',
            matched_query: QUERY,
            retrieved_at: '2026-06-17T10:00:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  return workspaceRoot;
}

test('ingestWorkspaceCorpus builds canonical markdown, structured JSON, manifest, and chunks per workspace', async () => {
  const workspaceRoot = createWorkspaceRoot();

  const result = await ingestWorkspaceCorpus({
    workspaceRoot,
    query: QUERY,
    fetchImpl: async (url) => {
      assert.equal(url, 'https://example.org/alpha.pdf');
      return buildPdfResponse();
    },
    openDataLoaderConvertImpl: async (inputPaths, options) => {
      const [pdfPath] = inputPaths;
      const basename = pdfPath.split(/[/\\]/).pop().replace(/\.pdf$/i, '');
      writeFileSync(join(options.outputDir, `${basename}.md`), '# Introduction\n\nAI-assisted testing reduces regression time.', 'utf8');
      writeFileSync(
        join(options.outputDir, `${basename}.json`),
        JSON.stringify([
          {
            type: 'paragraph',
            'page number': 1,
            'bounding box': [72, 640, 540, 680],
            content: 'AI-assisted testing reduces regression time.',
          },
        ]),
        'utf8',
      );
    },
    extractTextImpl: async () => 'AI-assisted testing reduces regression time.',
  });

  assert.equal(result.summary.totalArticles, 2);
  assert.equal(result.summary.ingestedArticles, 2);
  assert.equal(result.summary.parsers.opendataloader, 1);
  assert.equal(result.summary.parsers.abstract, 1);
  assert.ok(existsSync(join(workspaceRoot, 'output', 'article-markdown', 'doi-10-1000-alpha.md')));
  assert.ok(existsSync(join(workspaceRoot, 'output', 'article-structured', 'doi-10-1000-alpha.json')));
  assert.ok(existsSync(join(workspaceRoot, 'output', 'chunks.jsonl')));
  assert.ok(existsSync(join(workspaceRoot, 'data', 'corpus-manifest.json')));

  const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'data', 'corpus-manifest.json'), 'utf8'));
  const chunks = readFileSync(join(workspaceRoot, 'output', 'chunks.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));

  assert.equal(manifest.workspace.query, QUERY);
  assert.equal(manifest.articles.length, 2);
  assert.ok(chunks.some((chunk) => chunk.article_id === 'doi-10-1000-alpha' && chunk.page === 1));
  assert.ok(chunks.some((chunk) => chunk.text_source === 'record_abstract'));
});

test('answerWorkspaceQuestion uses only workspace chunks and returns strict citations', async () => {
  const workspaceRoot = createWorkspaceRoot();

  await ingestWorkspaceCorpus({
    workspaceRoot,
    query: QUERY,
    fetchImpl: async () => buildPdfResponse(),
    openDataLoaderConvertImpl: async (inputPaths, options) => {
      const [pdfPath] = inputPaths;
      const basename = pdfPath.split(/[/\\]/).pop().replace(/\.pdf$/i, '');
      writeFileSync(join(options.outputDir, `${basename}.md`), '# Results\n\nAutonomous agents reduced regression execution time in web systems.', 'utf8');
      writeFileSync(
        join(options.outputDir, `${basename}.json`),
        JSON.stringify([
          {
            type: 'paragraph',
            'page number': 3,
            'bounding box': [72, 540, 540, 590],
            content: 'Autonomous agents reduced regression execution time in web systems.',
          },
        ]),
        'utf8',
      );
    },
    extractTextImpl: async () => 'Autonomous agents reduced regression execution time in web systems.',
  });

  const result = await answerWorkspaceQuestion({
    workspaceRoot,
    question: 'Quais evidências mostram redução do tempo de regressão?',
    questionAnswerer: async ({ question, evidenceChunks }) => {
      assert.equal(question, 'Quais evidências mostram redução do tempo de regressão?');
      assert.ok(evidenceChunks.length >= 1);
      return {
        answer: 'Os artigos indicam redução do tempo de regressão com agentes autônomos.',
        confidence: 'high',
        supporting_evidence: [
          {
            title: 'AI-Augmented Software Testing Pipelines',
            page: '3',
            quote: 'Autonomous agents reduced regression execution time in web systems.',
          },
        ],
        limitations: ['Base restrita aos artigos ingeridos nesta pasta.'],
      };
    },
  });

  assert.equal(result.answer.confidence, 'high');
  assert.equal(result.answer.citations.length, 1);
  assert.equal(result.answer.citations[0].title, 'AI-Augmented Software Testing Pipelines');
  assert.equal(result.answer.citations[0].page, '3');
  assert.equal(result.answer.citations[0].doi, '10.1000/alpha');
  assert.ok(existsSync(result.artifacts.answerJson));
  assert.ok(existsSync(result.artifacts.answerMarkdown));
});
