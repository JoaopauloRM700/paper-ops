import { runCommand } from './engine.mjs';

export async function checkOcrEngineAvailability({
  command = 'ocrmypdf',
  commandRunner = runCommand,
} = {}) {
  const result = await commandRunner(command, ['--version']);
  if (result.code !== 0) {
    return {
      available: false,
      engine: 'ocrmypdf',
      version: '',
      error: String(result.stderr || result.stdout || 'ocrmypdf command failed').trim(),
    };
  }

  return {
    available: true,
    engine: 'ocrmypdf',
    version: String(result.stdout || result.stderr).trim(),
    error: '',
  };
}

export async function runOcrForPdf({
  inputPdfPath,
  outputPdfPath,
  language = 'eng',
  command = 'ocrmypdf',
  commandRunner = runCommand,
} = {}) {
  const args = [
    '--skip-text',
    '--rotate-pages',
    '--deskew',
    '--output-type',
    'pdf',
    '-l',
    language,
    inputPdfPath,
    outputPdfPath,
  ];
  const result = await commandRunner(command, args);
  if (result.code !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'ocrmypdf failed').trim());
  }
  return { outputPdfPath };
}
