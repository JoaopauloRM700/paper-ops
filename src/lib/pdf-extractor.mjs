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
  return module.default ?? module.PDFParse ?? module;
}

function isClassConstructorCallError(error) {
  return error instanceof TypeError
    && /class constructor|cannot be invoked without 'new'|without new/i.test(error.message);
}

async function parsePdfBuffer(buffer, pdfParse) {
  if (typeof pdfParse === 'function') {
    try {
      const parsed = await pdfParse(buffer);
      return parsed?.text ?? '';
    } catch (error) {
      if (!isClassConstructorCallError(error)) {
        throw error;
      }
    }

    const parser = new pdfParse({ data: buffer });
    const result = await parser.getText();
    return result?.text ?? '';
  }

  const ParserClass = pdfParse?.PDFParse ?? pdfParse?.default?.PDFParse;
  if (typeof ParserClass === 'function') {
    const parser = new ParserClass({ data: buffer });
    const result = await parser.getText();
    return result?.text ?? '';
  }

  throw new Error('Unsupported pdf-parse export shape.');
}

export async function extractTextFromPdfFile(pdfPath, options = {}) {
  const {
    pdfParseImpl,
    minimumCharacters = 200,
  } = options;
  const buffer = readFileSync(pdfPath);
  const pdfParse = pdfParseImpl ?? await loadPdfParse();
  const normalizedText = normalizeExtractedText(await parsePdfBuffer(buffer, pdfParse));

  if (normalizedText.length < minimumCharacters) {
    throw new Error('Extracted text is too short; the PDF may be scanned, empty, or unreadable.');
  }

  return normalizedText;
}
