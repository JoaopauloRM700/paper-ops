import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripWrappingQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseDotEnv(rawText) {
  const parsed = {};

  for (const rawLine of String(rawText ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

export function readProjectEnv(projectRoot, env = process.env) {
  const envPath = join(projectRoot, '.env');
  if (!existsSync(envPath)) {
    return { ...env };
  }

  return {
    ...parseDotEnv(readFileSync(envPath, 'utf8')),
    ...env,
  };
}
