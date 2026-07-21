#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processBatchQueries } from './src/lib/batch.mjs';
import {
  answerWorkspaceQuestion,
  digestQueryArticles,
  fetchQueryPdfs,
  ingestWorkspaceCorpus,
  summarizeQueryArticles,
} from './src/lib/article-digest.mjs';
import { routeCliInput, renderHelpMenu } from './src/lib/cli.mjs';
import { readSourcesConfig } from './src/lib/config.mjs';
import { exportQueryResultsToCsv } from './src/lib/csv-export.mjs';
import { openPaperOpsDatabase } from './src/lib/db/database.mjs';
import { initializePaperOpsSchema } from './src/lib/db/schema.mjs';
import { ocrQueryPdfs } from './src/lib/ocr/workflow.mjs';
import { processQueuedSearches } from './src/lib/pipeline.mjs';
import { answerQueryWithRag } from './src/lib/rag/answerer.mjs';
import { embedQueryChunks } from './src/lib/rag/embeddings/indexer.mjs';
import { collectEvidenceForQuestion } from './src/lib/rag/evidence.mjs';
import { indexQueryForRag } from './src/lib/rag/indexer.mjs';
import { exportReferencesForQuery } from './src/lib/rag/references.mjs';
import { buildLiteratureMatrix, draftSectionFromEvidence } from './src/lib/rag/writing-tools.mjs';
import { resolveQueryInput } from './src/lib/research-profile.mjs';
import { runSearchAndPersist } from './src/lib/search-runner.mjs';
import { readSearchHistory } from './src/lib/tracker.mjs';
import { initializeWorkspace } from './src/lib/workspace.mjs';
import {
  renderDbInitSummary,
  renderCsvExportSummary,
  renderDraftSummary,
  renderEmbeddingSummary,
  renderEvidenceSummary,
  renderMatrixSummary,
  renderOcrSummary,
  renderPdfFetchSummary,
  renderArticleSummaryWorkflowSummary,
  renderQuestionAnswerSummary,
  renderRagAnswerSummary,
  renderRagIndexSummary,
  renderReferencesSummary,
  renderSearchCollectionSummary,
  renderSearchHistorySummary,
  renderSearchRunSummary,
  renderWorkspaceCorpusSummary,
  renderWorkspaceInitSummary,
} from './src/lib/terminal-ui.mjs';

function readIntegerFlag(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const { stdout = console.log } = io;
  const routed = routeCliInput(argv);
  const projectRoot = resolve(routed.flags.projectRoot || process.cwd());

  if (routed.mode === 'help' || (!routed.query && (routed.mode === 'search' || routed.mode === 'csv' || routed.mode === 'workspace-init'))) {
    stdout(renderHelpMenu());
    return { mode: 'help' };
  }

  if (!routed.query && ['fetch-pdfs', 'summarize', 'digest', 'ask', 'ingest', 'ocr', 'embed', 'index', 'evidence', 'references', 'matrix', 'draft'].includes(routed.mode)) {
    stdout(renderHelpMenu());
    return { mode: 'help' };
  }

  if (['ask', 'evidence', 'draft'].includes(routed.mode) && !routed.flags.question) {
    stdout(renderHelpMenu());
    return { mode: 'help' };
  }

  const fixtureDir = new URL('./tests/fixtures/', import.meta.url);

  function loadConfiguredSources() {
    const config = readSourcesConfig(projectRoot);
    if (routed.flags.fixtures) {
      config.defaults.fixture_mode = true;
      for (const [sourceName, sourceConfig] of Object.entries(config.sources)) {
        sourceConfig.mode = sourceConfig.fixture ? 'fixture' : sourceConfig.mode;
        if (sourceName === 'google_scholar' && !sourceConfig.fixture) {
          sourceConfig.enabled = false;
        }
      }
    }

    return config;
  }

  switch (routed.mode) {
    case 'search': {
      const config = loadConfiguredSources();
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await runSearchAndPersist({
        query: resolved.query,
        profile: resolved.profile,
        config,
        projectRoot: targetRoot,
        fixtureDir,
      });
      stdout(renderSearchRunSummary(result));
      return result;
    }
    case 'pipeline': {
      const config = loadConfiguredSources();
      const results = await processQueuedSearches({
        config,
        projectRoot,
        fixtureDir,
      });
      stdout(renderSearchCollectionSummary('pipeline', results));
      return results;
    }
    case 'csv': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = exportQueryResultsToCsv({
        projectRoot: targetRoot,
        query: resolved.query,
      });
      stdout(renderCsvExportSummary(result));
      return result;
    }
    case 'fetch-pdfs': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await fetchQueryPdfs({
        projectRoot: targetRoot,
        query: resolved.query,
        targetDir: routed.flags.outputDir,
        useTitleAsFilename: routed.flags.useTitle,
      });
      stdout(renderPdfFetchSummary(result));
      return result;
    }
    case 'summarize': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await summarizeQueryArticles({
        projectRoot: targetRoot,
        query: resolved.query,
        refreshText: routed.flags.refreshText,
      });
      stdout(renderArticleSummaryWorkflowSummary('summarize', result));
      return result;
    }
    case 'digest': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await digestQueryArticles({
        projectRoot: targetRoot,
        query: resolved.query,
        refreshText: routed.flags.refreshText,
      });
      stdout(renderArticleSummaryWorkflowSummary('digest', result));
      return result;
    }
    case 'ingest': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await ingestWorkspaceCorpus({
        workspaceRoot: targetRoot,
        query: resolved.query,
        refreshCorpus: routed.flags.refreshCorpus,
      });
      stdout(renderWorkspaceCorpusSummary('ingest', result));
      return result;
    }
    case 'ask': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;

      if (resolved.workspace) {
        const result = await answerWorkspaceQuestion({
          workspaceRoot: targetRoot,
          query: resolved.query,
          question: routed.flags.question,
          refreshCorpus: routed.flags.refreshCorpus,
        });
        stdout(renderQuestionAnswerSummary(result));
        return result;
      }

      const result = await answerQueryWithRag({
        projectRoot: targetRoot,
        query: resolved.query,
        question: routed.flags.question,
        retrieval: routed.flags.retrieval || 'bm25',
        refreshText: routed.flags.refreshText,
        refreshIndex: routed.flags.refreshIndex,
        ocr: routed.flags.ocr,
        ocrLanguage: routed.flags.ocrLang || process.env.PAPER_OPS_OCR_LANG || 'eng',
        embed: routed.flags.embed,
        refreshEmbeddings: routed.flags.refreshEmbeddings,
        embeddingProviderName: routed.flags.embeddingProvider || process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
        embeddingModel: routed.flags.embeddingModel || process.env.PAPER_OPS_EMBEDDING_MODEL,
        topK: readIntegerFlag(routed.flags.topK, 12),
      });
      stdout(renderRagAnswerSummary(result));
      return result;
    }
    case 'ocr': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await ocrQueryPdfs({
        projectRoot: targetRoot,
        query: resolved.query,
        language: routed.flags.ocrLang || process.env.PAPER_OPS_OCR_LANG || 'eng',
        force: routed.flags.force,
      });
      stdout(renderOcrSummary(result));
      return result;
    }
    case 'embed': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      await indexQueryForRag({
        projectRoot: targetRoot,
        query: resolved.query,
        refreshIndex: routed.flags.refreshIndex,
        ocr: routed.flags.ocr,
        ocrLanguage: routed.flags.ocrLang || process.env.PAPER_OPS_OCR_LANG || 'eng',
      });
      const result = await embedQueryChunks({
        projectRoot: targetRoot,
        query: resolved.query,
        provider: routed.flags.embeddingProvider || process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
        model: routed.flags.embeddingModel || process.env.PAPER_OPS_EMBEDDING_MODEL,
        refreshEmbeddings: routed.flags.refreshEmbeddings,
      });
      stdout(renderEmbeddingSummary(result));
      return result;
    }
    case 'db': {
      if (routed.query !== 'init') {
        stdout(renderHelpMenu());
        return { mode: 'help' };
      }

      const db = openPaperOpsDatabase({ projectRoot });
      initializePaperOpsSchema(db);
      const databasePath = db.name;
      db.close();
      const result = { databasePath };
      stdout(renderDbInitSummary(result));
      return result;
    }
    case 'index': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await indexQueryForRag({
        projectRoot: targetRoot,
        query: resolved.query,
        refreshText: routed.flags.refreshText,
        refreshIndex: routed.flags.refreshIndex,
        ocr: routed.flags.ocr,
        ocrLanguage: routed.flags.ocrLang || process.env.PAPER_OPS_OCR_LANG || 'eng',
        embed: routed.flags.embed,
        refreshEmbeddings: routed.flags.refreshEmbeddings,
        embeddingProviderName: routed.flags.embeddingProvider || process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
        embeddingModel: routed.flags.embeddingModel || process.env.PAPER_OPS_EMBEDDING_MODEL,
      });
      stdout(renderRagIndexSummary(result));
      return result;
    }
    case 'evidence': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await collectEvidenceForQuestion({
        projectRoot: targetRoot,
        query: resolved.query,
        question: routed.flags.question,
        retrieval: routed.flags.retrieval || 'bm25',
        topK: readIntegerFlag(routed.flags.topK, 20),
        refreshIndex: routed.flags.refreshIndex,
        ocr: routed.flags.ocr,
        ocrLanguage: routed.flags.ocrLang || process.env.PAPER_OPS_OCR_LANG || 'eng',
        embed: routed.flags.embed,
        refreshEmbeddings: routed.flags.refreshEmbeddings,
        embeddingProviderName: routed.flags.embeddingProvider || process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture',
        embeddingModel: routed.flags.embeddingModel || process.env.PAPER_OPS_EMBEDDING_MODEL,
      });
      stdout(renderEvidenceSummary(result));
      return result;
    }
    case 'references': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      await indexQueryForRag({
        projectRoot: targetRoot,
        query: resolved.query,
        refreshIndex: routed.flags.refreshIndex,
      });
      const result = exportReferencesForQuery({
        projectRoot: targetRoot,
        query: resolved.query,
        format: routed.flags.format || 'all',
      });
      stdout(renderReferencesSummary(result));
      return result;
    }
    case 'matrix': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await buildLiteratureMatrix({
        projectRoot: targetRoot,
        query: resolved.query,
      });
      stdout(renderMatrixSummary(result));
      return result;
    }
    case 'draft': {
      const resolved = resolveQueryInput(routed.query, projectRoot);
      const targetRoot = resolved.workspace?.root ?? projectRoot;
      const result = await draftSectionFromEvidence({
        projectRoot: targetRoot,
        query: resolved.query,
        question: routed.flags.question,
        section: routed.flags.section || 'custom',
        topK: readIntegerFlag(routed.flags.topK, 12),
      });
      stdout(renderDraftSummary(result));
      return result;
    }
    case 'workspace-init': {
      const result = initializeWorkspace(projectRoot, routed.query);
      stdout(renderWorkspaceInitSummary(result));
      return result;
    }
    case 'tracker':
      {
        const history = readSearchHistory(projectRoot);
        stdout(renderSearchHistorySummary(history));
        return history;
      }
    case 'batch': {
      const config = loadConfiguredSources();
      const results = await processBatchQueries({
        config,
        projectRoot,
        fixtureDir,
      });
      stdout(renderSearchCollectionSummary('batch', results));
      return results;
    }
    default:
      stdout(renderHelpMenu());
      return { mode: 'help' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
