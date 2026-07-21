import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function slugify(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isWorkspaceRoot(projectRoot) {
  return existsSync(join(projectRoot, 'brief.md'));
}

export function resolveWorkspacePaths(projectRoot) {
  const workspaceMode = isWorkspaceRoot(projectRoot);
  const outputDir = join(projectRoot, 'output');
  const reportsDir = join(projectRoot, 'reports');

  return {
    workspaceMode,
    workspaceId: basename(projectRoot),
    projectRoot,
    briefPath: workspaceMode ? join(projectRoot, 'brief.md') : '',
    dataDir: join(projectRoot, 'data'),
    outputDir,
    reportsDir,
    searchRunsOutputDir: workspaceMode ? join(outputDir, 'search-runs') : outputDir,
    searchRunsReportDir: workspaceMode ? join(reportsDir, 'search-runs') : reportsDir,
    searchHistoryPath: join(projectRoot, 'data', 'search-history.md'),
    pdfDir: join(outputDir, 'pdfs'),
    textDir: join(outputDir, 'pdf-text'),
    articleMarkdownDir: join(outputDir, 'article-markdown'),
    articleStructuredDir: join(outputDir, 'article-structured'),
    summaryJsonDir: join(outputDir, 'article-summaries'),
    digestJsonDir: join(outputDir, 'digests'),
    answerJsonDir: join(outputDir, 'answers'),
    summaryMarkdownDir: join(reportsDir, 'article-summaries'),
    digestMarkdownDir: join(reportsDir, 'digests'),
    answerMarkdownDir: join(reportsDir, 'answers'),
    chunksPath: join(outputDir, 'chunks.jsonl'),
    corpusManifestPath: join(projectRoot, 'data', 'corpus-manifest.json'),
  };
}

export function ensureWorkspaceArtifactDirs(projectRoot) {
  const paths = resolveWorkspacePaths(projectRoot);
  const directories = [
    paths.dataDir,
    paths.outputDir,
    paths.reportsDir,
    paths.searchRunsOutputDir,
    paths.searchRunsReportDir,
    paths.pdfDir,
    paths.textDir,
    paths.articleMarkdownDir,
    paths.articleStructuredDir,
    paths.summaryJsonDir,
    paths.digestJsonDir,
    paths.answerJsonDir,
    paths.summaryMarkdownDir,
    paths.digestMarkdownDir,
    paths.answerMarkdownDir,
  ];

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }

  return paths;
}

export function buildWorkspaceBriefTemplate(slug) {
  const title = slug
    ? slug
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
    : 'Nova Pesquisa';

  return `# Projeto/Pesquisa
- ${title}

# Objetivo
- Descreva o objetivo principal desta pesquisa.

# String de busca
- ("topic a" OR "topic b") AND ("method x" OR "method y")

## Categoria: Assunto 1
### Abordagem / Detalhe
- Descreva a abordagem principal.

### Palavras-chave
- keyword one, keyword two
- keyword three, keyword four
`;
}

export function initializeWorkspace(projectRoot, slug) {
  const normalizedSlug = slugify(slug || 'workspace');
  const workspaceRoot = join(projectRoot, 'workspaces', normalizedSlug);
  const paths = ensureWorkspaceArtifactDirs(workspaceRoot);
  const briefPath = join(workspaceRoot, 'brief.md');

  if (!existsSync(briefPath)) {
    writeFileSync(briefPath, buildWorkspaceBriefTemplate(normalizedSlug), 'utf8');
  }

  return {
    mode: 'workspace-init',
    slug: normalizedSlug,
    root: workspaceRoot,
    briefPath,
    paths,
  };
}
