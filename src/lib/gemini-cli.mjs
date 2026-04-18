import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { routeCliInput } from './cli.mjs';

export function buildGeminiPrompt(argv = []) {
  const routed = routeCliInput(argv);
  const fixturesFlag = routed.flags.fixtures ? ' --fixtures' : '';

  if (routed.mode === 'help') {
    return 'paper-ops';
  }

  if (routed.mode === 'search') {
    return routed.query
      ? `paper-ops search ${JSON.stringify(routed.query)}${fixturesFlag}`
      : `paper-ops${fixturesFlag}`;
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
