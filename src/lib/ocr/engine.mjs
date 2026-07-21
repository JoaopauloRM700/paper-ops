import { spawn } from 'node:child_process';

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function createOcrRunId(articleId, now = new Date()) {
  return `ocr-${String(articleId ?? 'article').replace(/[^a-z0-9_-]+/gi, '-')}-${now.toISOString().replace(/[:.]/g, '-')}`;
}
