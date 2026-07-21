import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRetrievalQuality } from '../src/lib/rag/evaluation.mjs';

test('evaluateRetrievalQuality calculates precision, recall, and MRR', () => {
  const metrics = evaluateRetrievalQuality({
    expected: [['chunk-method'], ['chunk-limits'], ['chunk-results']],
    retrieved: [['chunk-method'], ['chunk-limits'], ['chunk-results']],
    k: 1,
  });

  assert.equal(metrics.precisionAtK, 1);
  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.mrr, 1);
});

test('evaluateRetrievalQuality accounts for late relevant hits', () => {
  const metrics = evaluateRetrievalQuality({
    expected: [['chunk-method']],
    retrieved: [['chunk-other', 'chunk-method']],
    k: 1,
  });

  assert.equal(metrics.precisionAtK, 0);
  assert.equal(metrics.recallAtK, 0);
  assert.equal(metrics.mrr, 0.5);
});
