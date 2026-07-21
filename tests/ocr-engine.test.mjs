import test from 'node:test';
import assert from 'node:assert/strict';

import { createOcrRunId } from '../src/lib/ocr/engine.mjs';
import { checkOcrEngineAvailability, runOcrForPdf } from '../src/lib/ocr/ocrmypdf.mjs';

test('checkOcrEngineAvailability reports available ocrmypdf command', async () => {
  const result = await checkOcrEngineAvailability({
    commandRunner: async () => ({ code: 0, stdout: 'ocrmypdf 17.8.1', stderr: '' }),
  });

  assert.deepEqual(result, {
    available: true,
    engine: 'ocrmypdf',
    version: 'ocrmypdf 17.8.1',
    error: '',
  });
});

test('checkOcrEngineAvailability reports missing ocrmypdf command', async () => {
  const result = await checkOcrEngineAvailability({
    commandRunner: async () => ({ code: 1, stdout: '', stderr: 'not found' }),
  });

  assert.equal(result.available, false);
  assert.equal(result.engine, 'ocrmypdf');
  assert.equal(result.error, 'not found');
});

test('runOcrForPdf builds the expected ocrmypdf command', async () => {
  const calls = [];
  await runOcrForPdf({
    inputPdfPath: 'input.pdf',
    outputPdfPath: 'output.pdf',
    language: 'por+eng',
    commandRunner: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(calls[0].command, 'ocrmypdf');
  assert.deepEqual(calls[0].args, [
    '--skip-text',
    '--rotate-pages',
    '--deskew',
    '--output-type',
    'pdf',
    '-l',
    'por+eng',
    'input.pdf',
    'output.pdf',
  ]);
});

test('createOcrRunId creates stable readable ids', () => {
  assert.equal(
    createOcrRunId('doi-10-1000-scan', new Date('2026-07-21T12:00:00.000Z')),
    'ocr-doi-10-1000-scan-2026-07-21T12-00-00-000Z',
  );
});
