import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractTextFromPdfFile } from '../src/lib/pdf-extractor.mjs';

function createPdfFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-ops-pdf-'));
  const pdfPath = join(projectRoot, 'fixture.pdf');
  writeFileSync(pdfPath, '%PDF-1.4\n%%EOF');
  return pdfPath;
}

test('extractTextFromPdfFile supports classic pdf-parse function exports', async () => {
  const text = await extractTextFromPdfFile(createPdfFixture(), {
    minimumCharacters: 10,
    pdfParseImpl: async () => ({
      text: 'First line.\n\nSecond line with enough text.',
    }),
  });

  assert.equal(text, 'First line.\nSecond line with enough text.');
});

test('extractTextFromPdfFile supports modern PDFParse class exports', async () => {
  class ModernPdfParser {
    constructor({ data }) {
      assert.ok(Buffer.isBuffer(data));
    }

    async getText() {
      return {
        text: 'Modern parser text.\n\nEnough content for extraction.',
      };
    }
  }

  const text = await extractTextFromPdfFile(createPdfFixture(), {
    minimumCharacters: 10,
    pdfParseImpl: ModernPdfParser,
  });

  assert.equal(text, 'Modern parser text.\nEnough content for extraction.');
});

test('extractTextFromPdfFile supports namespace exports with PDFParse', async () => {
  class NamespacePdfParser {
    async getText() {
      return {
        text: 'Namespace parser text.\n\nEnough content for extraction.',
      };
    }
  }

  const text = await extractTextFromPdfFile(createPdfFixture(), {
    minimumCharacters: 10,
    pdfParseImpl: {
      PDFParse: NamespacePdfParser,
    },
  });

  assert.equal(text, 'Namespace parser text.\nEnough content for extraction.');
});
