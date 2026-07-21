const KNOWN_MODES = new Set([
  'search',
  'pipeline',
  'tracker',
  'batch',
  'csv',
  'fetch-pdfs',
  'summarize',
  'digest',
  'ask',
  'ocr',
  'embed',
  'db',
  'index',
  'evidence',
  'references',
  'matrix',
  'draft',
  'help',
]);

function isFlag(token) {
  return token.startsWith('--');
}

export function routeCliInput(argv = []) {
  if (argv.length === 0) {
    return { mode: 'help', query: '', flags: {} };
  }

  const flags = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (isFlag(token)) {
      if (token.startsWith('--question=')) {
        flags.question = token.slice('--question='.length);
        continue;
      }

      if (token === '--question') {
        flags.question = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token === '--refresh-text') {
        flags.refreshText = true;
        continue;
      }

      if (token === '--refresh-index') {
        flags.refreshIndex = true;
        continue;
      }

      if (token === '--ocr') {
        flags.ocr = true;
        continue;
      }

      if (token === '--force') {
        flags.force = true;
        continue;
      }

      if (token.startsWith('--ocr-lang=')) {
        flags.ocrLang = token.slice('--ocr-lang='.length);
        continue;
      }

      if (token === '--ocr-lang') {
        flags.ocrLang = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token === '--embed') {
        flags.embed = true;
        continue;
      }

      if (token === '--refresh-embeddings') {
        flags.refreshEmbeddings = true;
        continue;
      }

      if (token.startsWith('--retrieval=')) {
        flags.retrieval = token.slice('--retrieval='.length);
        continue;
      }

      if (token === '--retrieval') {
        flags.retrieval = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token.startsWith('--embedding-provider=')) {
        flags.embeddingProvider = token.slice('--embedding-provider='.length);
        continue;
      }

      if (token === '--embedding-provider') {
        flags.embeddingProvider = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token.startsWith('--embedding-model=')) {
        flags.embeddingModel = token.slice('--embedding-model='.length);
        continue;
      }

      if (token === '--embedding-model') {
        flags.embeddingModel = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token.startsWith('--top-k=')) {
        flags.topK = Number.parseInt(token.slice('--top-k='.length), 10);
        continue;
      }

      if (token === '--top-k') {
        flags.topK = Number.parseInt(argv[index + 1] ?? '', 10);
        index += 1;
        continue;
      }

      if (token.startsWith('--format=')) {
        flags.format = token.slice('--format='.length);
        continue;
      }

      if (token === '--format') {
        flags.format = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token.startsWith('--section=')) {
        flags.section = token.slice('--section='.length);
        continue;
      }

      if (token === '--section') {
        flags.section = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      if (token === '--fixtures') {
        flags.fixtures = true;
        continue;
      }

      if (token === '--project-root') {
        flags.projectRoot = argv[index + 1] ?? '';
        index += 1;
        continue;
      }

      flags[token.replace(/^--/, '')] = true;
      continue;
    }

    positional.push(token);
  }

  const [first, ...rest] = positional;

  if (KNOWN_MODES.has(first)) {
    return {
      mode: first,
      query: rest.join(' ').trim(),
      flags,
    };
  }

  return {
    mode: 'search',
    query: positional.join(' ').trim(),
    flags,
  };
}

export function renderHelpMenu() {
  return `paper-ops -- Academic Paper Search\n\nGemini-first usage:\n  gemini                          -> Open Gemini CLI in this repo, then type paper-ops ...\n  paper-ops-gemini <command>      -> Run a one-shot Gemini prompt through the paper-ops router\n\nAvailable commands:\n  paper-ops search "<query>"      -> Run a multi-source search, show a terminal summary, and save report + JSON\n  paper-ops fetch-pdfs "<query>"  -> Download available PDFs for one saved search string\n  paper-ops summarize "<query>"   -> Extract text and generate structured summaries for saved search results\n  paper-ops digest "<query>"      -> Build a consolidated digest across summarized articles for one query\n  paper-ops ask "<query>" --question "<question>" -> Answer a question using the local RAG database\n  paper-ops evidence "<query>" --question "<question>" -> Export retrieved evidence chunks\n  paper-ops references "<query>"  -> Export ABNT/BibTeX/APA references from indexed articles\n  paper-ops matrix "<query>"      -> Export a literature matrix for indexed articles\n  paper-ops draft "<query>" --section "<section>" --question "<focus>" -> Draft a sourced section\n  paper-ops index "<query>"       -> Build or refresh the local SQLite RAG index\n  paper-ops ocr "<query>"         -> OCR cached/downloadable PDFs for one saved query\n  paper-ops embed "<query>"       -> Generate semantic embeddings for indexed chunks\n  paper-ops db init               -> Initialize data/paper-ops.sqlite\n  paper-ops csv "<query>"         -> Export a deduplicated CSV using saved results for one search string\n  paper-ops pipeline               -> Process queued searches from data/search-queue.md\n  paper-ops tracker                -> Show saved search history in terminal form\n  paper-ops batch                  -> Process batch/batch-input.tsv\n  paper-ops <query>                -> Treat raw query text as a search request`;
}
