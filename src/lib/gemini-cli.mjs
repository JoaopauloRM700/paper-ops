import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { routeCliInput } from './cli.mjs';

export function buildGeminiPrompt(argv = []) {
  const routed = routeCliInput(argv);
  const fixturesFlag = routed.flags.fixtures ? ' --fixtures' : '';
  const questionFlag = routed.flags.question ? ` --question ${JSON.stringify(routed.flags.question)}` : '';
  const refreshTextFlag = routed.flags.refreshText ? ' --refresh-text' : '';
  const refreshCorpusFlag = routed.flags.refreshCorpus ? ' --refresh-corpus' : '';
  const refreshIndexFlag = routed.flags.refreshIndex ? ' --refresh-index' : '';
  const ocrFlag = routed.flags.ocr ? ' --ocr' : '';
  const ocrLangFlag = routed.flags.ocrLang ? ` --ocr-lang ${routed.flags.ocrLang}` : '';
  const forceFlag = routed.flags.force ? ' --force' : '';
  const embedFlag = routed.flags.embed ? ' --embed' : '';
  const refreshEmbeddingsFlag = routed.flags.refreshEmbeddings ? ' --refresh-embeddings' : '';
  const retrievalFlag = routed.flags.retrieval ? ` --retrieval ${routed.flags.retrieval}` : '';
  const embeddingProviderFlag = routed.flags.embeddingProvider ? ` --embedding-provider ${routed.flags.embeddingProvider}` : '';
  const embeddingModelFlag = routed.flags.embeddingModel ? ` --embedding-model ${routed.flags.embeddingModel}` : '';
  const topKFlag = Number.isFinite(routed.flags.topK) ? ` --top-k ${routed.flags.topK}` : '';
  const formatFlag = routed.flags.format ? ` --format ${routed.flags.format}` : '';
  const sectionFlag = routed.flags.section ? ` --section ${routed.flags.section}` : '';
  const outputDirFlag = routed.flags.outputDir ? ` --output-dir ${JSON.stringify(routed.flags.outputDir)}` : '';
  const useTitleFlag = routed.flags.useTitle ? ' --use-title' : '';
  const composedFlags = `${questionFlag}${refreshTextFlag}${refreshCorpusFlag}${refreshIndexFlag}${ocrFlag}${ocrLangFlag}${forceFlag}${embedFlag}${refreshEmbeddingsFlag}${retrievalFlag}${embeddingProviderFlag}${embeddingModelFlag}${topKFlag}${formatFlag}${sectionFlag}${outputDirFlag}${useTitleFlag}${fixturesFlag}`;

  if (routed.mode === 'help') {
    return 'paper-ops';
  }

  if (['search', 'csv', 'fetch-pdfs', 'summarize', 'digest', 'ask', 'ingest', 'ocr', 'embed', 'index', 'evidence', 'references', 'matrix', 'draft'].includes(routed.mode)) {
    return routed.query
      ? `paper-ops ${routed.mode} ${JSON.stringify(routed.query)}${composedFlags}`
      : `paper-ops${composedFlags}`;
  }

  if (routed.mode === 'workspace-init') {
    return routed.query
      ? `paper-ops workspace init ${JSON.stringify(routed.query)}${fixturesFlag}`
      : 'paper-ops';
  }

  return `paper-ops ${routed.mode}${fixturesFlag}`;
}

export function resolveGeminiRunContext(argv = [], cwd = process.cwd()) {
  const routed = routeCliInput(argv);
  return {
    cwd: resolve(routed.flags.projectRoot || cwd),
    prompt: buildGeminiPrompt(argv),
  };
}

export async function runGeminiPaperOps(argv = process.argv.slice(2), options = {}) {
  const { spawnImpl = spawn, cwd = process.cwd() } = options;
  const runContext = resolveGeminiRunContext(argv, cwd);

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl('gemini', ['-p', runContext.prompt], {
      cwd: runContext.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Gemini CLI exited with code ${code}`));
    });
  });
}
