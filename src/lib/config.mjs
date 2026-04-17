import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_SOURCES = ['scopus', 'ieee', 'acm', 'google_scholar'];

export function loadSourcesConfig(rawConfig = {}) {
  const defaults = {
    per_source_limit: 10,
    fixture_mode: false,
    ...(rawConfig.defaults ?? {}),
  };

  const sources = {};

  for (const sourceName of DEFAULT_SOURCES) {
    const sourceConfig = rawConfig.sources?.[sourceName] ?? {};
    sources[sourceName] = {
      enabled: false,
      mode: defaults.fixture_mode ? 'fixture' : 'live',
      experimental: false,
      ...sourceConfig,
    };
  }

  return { defaults, sources };
}

export function readSourcesConfig(projectRoot) {
  const configPath = join(projectRoot, 'config', 'sources.yml');
  const rawText = readFileSync(configPath, 'utf8');
  return loadSourcesConfig(JSON.parse(rawText));
}
