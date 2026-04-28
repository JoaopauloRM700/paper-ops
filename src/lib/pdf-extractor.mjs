import { readFileSync } from 'node:fs';

function normalizeExtractedText(text) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

async function loadPdfParse() {
  const module = await import('pdf-parse');
  return module.default ?? module;
}

export async function extractTextFromPdfFile(pdfPath, options = {}) {
  const {
    pdfParseImpl,
    minimumCharacters = 200,
  } = options;
  const buffer = readFileSync(pdfPath);
  const pdfParse = pdfParseImpl ?? await loadPdfParse();
  const parsed = await pdfParse(buffer);
  const normalizedText = normalizeExtractedText(parsed?.text ?? '');

  if (normalizedText.length < minimumCharacters) {
    throw new Error('Extracted text is too short; the PDF may be scanned, empty, or unreadable.');
  }

  return normalizedText;
}
