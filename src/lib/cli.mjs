const KNOWN_MODES = new Set(['search', 'pipeline', 'tracker', 'batch', 'csv', 'fetch-pdfs', 'summarize', 'digest', 'ask', 'help']);

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
  return `paper-ops -- Academic Paper Search\n\nGemini-first usage:\n  gemini                          -> Open Gemini CLI in this repo, then type paper-ops ...\n  paper-ops-gemini <command>      -> Run a one-shot Gemini prompt through the paper-ops router\n\nAvailable commands:\n  paper-ops search "<query>"      -> Run a multi-source search, show a terminal summary, and save report + JSON\n  paper-ops fetch-pdfs "<query>"  -> Download available PDFs for one saved search string\n  paper-ops summarize "<query>"   -> Extract text and generate structured summaries for saved search results\n  paper-ops digest "<query>"      -> Build a consolidated digest across summarized articles for one query\n  paper-ops ask "<query>" --question "<question>" -> Answer a question using saved PDF/abstract text\n  paper-ops csv "<query>"         -> Export a deduplicated CSV using saved results for one search string\n  paper-ops pipeline               -> Process queued searches from data/search-queue.md\n  paper-ops tracker                -> Show saved search history in terminal form\n  paper-ops batch                  -> Process batch/batch-input.tsv\n  paper-ops <query>                -> Treat raw query text as a search request`;
}
