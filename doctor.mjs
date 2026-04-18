#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSourcesConfig } from './src/lib/config.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const requiredSourceKeys = ['scopus', 'ieee', 'acm', 'google_scholar'];

function commandExists(name) {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(resolver, [name], { stdio: 'ignore' });
  return result.status === 0;
}

function createCheck(ok, label, hint = '') {
  return { ok, label, hint };
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  return createCheck(major >= 18, `Node.js >= 18 (found ${process.versions.node})`, 'Install Node.js 18 or later.');
}

function checkConfigFile() {
  const configPath = join(projectRoot, 'config', 'sources.yml');
  if (!existsSync(configPath)) {
    return createCheck(false, 'config/sources.yml found', 'Restore or create config/sources.yml.');
  }

  try {
    const parsed = readSourcesConfig(projectRoot);
    const missingSources = requiredSourceKeys.filter((key) => !parsed.sources || !parsed.sources[key]);
    if (missingSources.length > 0) {
      return createCheck(
        false,
        'config/sources.yml defines required sources',
        `Add source entries for: ${missingSources.join(', ')}`,
      );
    }

    const missingSearchUrls = Object.entries(parsed.sources ?? {})
      .filter(([, sourceConfig]) => sourceConfig.enabled && sourceConfig.mode === 'live' && !sourceConfig.search_url)
      .map(([sourceName]) => sourceName);
    if (missingSearchUrls.length > 0) {
      return createCheck(
        false,
        'config/sources.yml defines browser search URLs for live sources',
        `Add search_url for: ${missingSearchUrls.join(', ')}`,
      );
    }

    const missingApiUrls = Object.entries(parsed.sources ?? {})
      .filter(([, sourceConfig]) => sourceConfig.enabled && sourceConfig.mode === 'api' && !sourceConfig.api_url)
      .map(([sourceName]) => sourceName);
    if (missingApiUrls.length > 0) {
      return createCheck(
        false,
        'config/sources.yml defines API endpoints for api sources',
        `Add api_url for: ${missingApiUrls.join(', ')}`,
      );
    }

    return createCheck(true, 'config/sources.yml parsed successfully');
  } catch (error) {
    return createCheck(
      false,
      'config/sources.yml parsed successfully',
      `The file must stay JSON-compatible YAML. Parse error: ${error.message}`,
    );
  }
}

function checkApiCredentials() {
  try {
    const parsed = readSourcesConfig(projectRoot);
    const missingApiKeys = Object.entries(parsed.sources ?? {})
      .filter(([, sourceConfig]) => sourceConfig.enabled && sourceConfig.mode === 'api' && !sourceConfig.api_key)
      .map(([sourceName]) => sourceName);

    if (missingApiKeys.length === 0) {
      return createCheck(true, 'API credentials ready for api sources');
    }

    return {
      level: 'warn',
      label: `API credentials missing for api sources: ${missingApiKeys.join(', ')}`,
      hint: 'Provide keys via config/keys.txt or environment variables before running api-mode searches.',
    };
  } catch {
    return {
      level: 'warn',
      label: 'API credentials could not be validated',
      hint: 'Fix config parsing errors first, then rerun doctor.',
    };
  }
}

function checkProjectDir(name) {
  const target = join(projectRoot, name);
  try {
    mkdirSync(target, { recursive: true });
    return createCheck(true, `${name}/ ready`);
  } catch {
    return createCheck(false, `${name}/ ready`, `Could not create ${name}/.`);
  }
}

function checkFixtures() {
  const missing = ['scopus.json', 'ieee.json', 'acm.json', 'scholar.json']
    .map((file) => join(projectRoot, 'tests', 'fixtures', file))
    .filter((path) => !existsSync(path));

  return createCheck(
    missing.length === 0,
    'fixture responses available',
    missing.length === 0 ? '' : `Missing fixtures: ${missing.join(', ')}`,
  );
}

async function checkPlaywrightRuntime() {
  let executablePath = '';
  try {
    const { chromium } = await import('playwright');
    executablePath = chromium.executablePath();
  } catch {
    return createCheck(
      false,
      'Playwright runtime available',
      'Run `npm install playwright` in the repo root.',
    );
  }

  if (!executablePath || !existsSync(executablePath)) {
    return createCheck(
      false,
      'Chromium browser installed',
      'Run `npx playwright install chromium` in the repo root.',
    );
  }

  return createCheck(true, 'Playwright runtime and Chromium browser available');
}

function checkBatchAssets() {
  const required = [
    join(projectRoot, 'batch', 'README.md'),
    join(projectRoot, 'batch', 'batch-input.tsv'),
    join(projectRoot, 'batch', 'batch-runner.sh'),
    join(projectRoot, 'batch', 'batch-prompt.md'),
    join(projectRoot, 'batch', 'worker-output.schema.json'),
  ];

  const missing = required.filter((path) => !existsSync(path));
  return createCheck(
    missing.length === 0,
    'batch assets available',
    missing.length === 0 ? '' : `Missing batch files: ${missing.join(', ')}`,
  );
}

function checkPluginSurface() {
  const pluginFile = join(projectRoot, 'plugins', 'paper-ops', '.codex-plugin', 'plugin.json');
  const skillFile = join(projectRoot, 'plugins', 'paper-ops', 'skills', 'paper-ops', 'SKILL.md');
  const missing = [pluginFile, skillFile].filter((path) => !existsSync(path));
  return createCheck(
    missing.length === 0,
    'plugin metadata available',
    missing.length === 0 ? '' : `Missing plugin files: ${missing.join(', ')}`,
  );
}

function checkAgentCli() {
  const found = ['gemini', 'claude', 'codex'].filter(commandExists);
  if (found.length === 0) {
    return { level: 'warn', label: 'No Gemini, Claude, or Codex CLI found in PATH', hint: 'The repo still works via node, but agent routing will be limited.' };
  }

  if (!found.includes('gemini')) {
    return {
      level: 'warn',
      label: `Gemini CLI not found in PATH (other agents detected: ${found.join(', ')})`,
      hint: 'Install Gemini CLI to use `gemini` or `paper-ops-gemini`; the direct node runtime still works without it.',
    };
  }

  return { level: 'ok', label: `Gemini CLI detected${found.length > 1 ? ` (${found.join(', ')})` : ''}`, hint: '' };
}

export async function getDoctorChecks() {
  return [
    checkNodeVersion(),
    checkConfigFile(),
    checkApiCredentials(),
    await checkPlaywrightRuntime(),
    checkProjectDir('data'),
    checkProjectDir('reports'),
    checkProjectDir('output'),
    checkProjectDir('batch'),
    checkFixtures(),
    checkBatchAssets(),
    checkPluginSurface(),
    checkAgentCli(),
  ];
}

export async function runDoctor(io = {}) {
  const { stdout = console.log } = io;
  const checks = await getDoctorChecks();
  let failures = 0;
  let warnings = 0;

  for (const check of checks) {
    const level = check.level ?? (check.ok ? 'ok' : 'err');
    if (level === 'ok') {
      stdout(`OK   ${check.label}`);
      continue;
    }

    if (level === 'warn') {
      warnings += 1;
      stdout(`WARN ${check.label}`);
      if (check.hint) {
        stdout(`     ${check.hint}`);
      }
      continue;
    }

    failures += 1;
    stdout(`ERR  ${check.label}`);
    if (check.hint) {
      stdout(`     ${check.hint}`);
    }
  }

  if (failures === 0) {
    stdout(`Result: doctor checks passed${warnings > 0 ? ` with ${warnings} warning(s)` : ''}.`);
  }

  return { checks, failures, warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await runDoctor();
  process.exit(result.failures === 0 ? 0 : 1);
}
