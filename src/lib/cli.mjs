const KNOWN_MODES = new Set(['search', 'pipeline', 'tracker', 'batch', 'help']);

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
  return `paper-ops -- Academic Paper Search\n\nGemini-first usage:\n  gemini                          -> Open Gemini CLI in this repo, then type paper-ops ...\n  paper-ops-gemini <command>      -> Run a one-shot Gemini prompt through the paper-ops router\n\nAvailable commands:\n  paper-ops search "<query>"      -> Run a multi-source search, show a terminal summary, and save report + JSON\n  paper-ops pipeline               -> Process queued searches from data/search-queue.md\n  paper-ops tracker                -> Show saved search history in terminal form\n  paper-ops batch                  -> Process batch/batch-input.tsv\n  paper-ops <query>                -> Treat raw query text as a search request`;
}
