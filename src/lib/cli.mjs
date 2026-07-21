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
  'ingest',
  'workspace-init',
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

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function normalizeFlagValue(key, value) {
  if (key === 'topK' && typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }

  return value;
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
      if (token.includes('=')) {
        const [key, ...valueParts] = token.replace(/^--/, '').split('=');
        const flagKey = toCamelCase(key);
        flags[flagKey] = normalizeFlagValue(flagKey, valueParts.join('='));
        continue;
      }

      const key = toCamelCase(token.replace(/^--/, ''));
      const nextToken = argv[index + 1];

      // If next token exists and is not a flag, treat it as the value
      if (nextToken !== undefined && !isFlag(nextToken)) {
        flags[key] = normalizeFlagValue(key, nextToken);
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positional.push(token);
  }

  const [first, ...rest] = positional;

  if (first === 'workspace' && rest[0] === 'init') {
    return {
      mode: 'workspace-init',
      query: rest.slice(1).join(' ').trim(),
      flags,
    };
  }

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
  return `paper-ops -- Academic Paper Search\n\nGemini-first usage:\n  gemini                          -> Open Gemini CLI in this repo, then type paper-ops ...\n  paper-ops-gemini <command>      -> Run a one-shot Gemini prompt through the paper-ops router\n\nAvailable commands:\n  paper-ops search "<query>"      -> Run a multi-source search, show a terminal summary, and save report + JSON\n  paper-ops search <workspace-dir> -> Run a search using brief.md and save artifacts inside that workspace\n  paper-ops fetch-pdfs "<query>"  -> Download available PDFs for one saved search string\n  paper-ops summarize "<query>"   -> Extract text and generate structured summaries for saved search results\n  paper-ops digest "<query>"      -> Build a consolidated digest across summarized articles for one query\n  paper-ops ask "<query>" --question "<question>" -> Answer using the local RAG database\n  paper-ops ask <workspace-dir> --question "<question>" -> Answer using the workspace corpus only\n  paper-ops evidence "<query>" --question "<question>" -> Export retrieved evidence chunks\n  paper-ops references "<query>"  -> Export ABNT/BibTeX/APA references from indexed articles\n  paper-ops matrix "<query>"      -> Export a literature matrix for indexed articles\n  paper-ops draft "<query>" --section "<section>" --question "<focus>" -> Draft a sourced section\n  paper-ops index "<query>"       -> Build or refresh the local SQLite RAG index\n  paper-ops ocr "<query>"         -> OCR cached/downloadable PDFs for one saved query\n  paper-ops embed "<query>"       -> Generate semantic embeddings for indexed chunks\n  paper-ops db init               -> Initialize data/paper-ops.sqlite\n  paper-ops ingest <workspace-dir> -> Build canonical markdown, structured JSON, manifest, and chunks for one workspace\n  paper-ops workspace init <slug> -> Create a new research workspace with a brief template\n  paper-ops csv "<query>"         -> Export a deduplicated CSV using saved results for one search string\n  paper-ops pipeline               -> Process queued searches from data/search-queue.md\n  paper-ops tracker                -> Show saved search history in terminal form\n  paper-ops batch                  -> Process batch/batch-input.tsv\n  paper-ops <query>                -> Treat raw query text as a search request`;
}
