import { createHash } from 'node:crypto';

import { createOpenAiEmbeddingProvider } from './openai-provider.mjs';

const FIXTURE_SYNONYMS = new Map([
  ['selected', 'screening'],
  ['select', 'screening'],
  ['selection', 'screening'],
  ['studies', 'study'],
  ['papers', 'paper'],
  ['documents', 'paper'],
  ['conceptual', 'semantic'],
  ['paraphrased', 'semantic'],
  ['paraphrase', 'semantic'],
  ['evidence', 'evidence'],
  ['citations', 'citation'],
]);

function parseFixtureDimension(model) {
  const match = String(model ?? '').match(/fixture-(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 64;
}

function normalizeToken(token) {
  const cleaned = String(token ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return FIXTURE_SYNONYMS.get(cleaned) ?? cleaned;
}

function tokenize(text) {
  return String(text ?? '')
    .split(/[^a-z0-9]+/i)
    .map(normalizeToken)
    .filter((token) => token.length >= 3);
}

function tokenSlot(token, dimension) {
  const hash = createHash('sha1').update(token).digest();
  return hash.readUInt32BE(0) % dimension;
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

function fixtureVector(text, dimension) {
  const vector = Array.from({ length: dimension }, () => 0);
  for (const token of tokenize(text)) {
    vector[tokenSlot(token, dimension)] += 1;
  }
  return normalizeVector(vector);
}

function createFixtureEmbeddingProvider({ model = 'fixture-64' } = {}) {
  const dimension = parseFixtureDimension(model);
  return {
    provider: 'fixture',
    model,
    async embedTexts(texts = []) {
      return {
        provider: 'fixture',
        model,
        dimension,
        vectors: texts.map((text) => fixtureVector(text, dimension)),
      };
    },
  };
}

export function createEmbeddingProvider(options = {}) {
  const provider = options.provider || process.env.PAPER_OPS_EMBEDDING_PROVIDER || 'fixture';
  const model = options.model || process.env.PAPER_OPS_EMBEDDING_MODEL || (provider === 'fixture' ? 'fixture-64' : 'text-embedding-3-small');

  if (provider === 'fixture') {
    return createFixtureEmbeddingProvider({ model });
  }

  if (provider === 'openai') {
    return createOpenAiEmbeddingProvider({ ...options, model });
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

export function cosineSimilarity(left = [], right = []) {
  let sum = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    sum += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return sum;
}
