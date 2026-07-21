import { existsSync, readFileSync } from 'node:fs';
import { resolveWorkspacePaths } from './workspace.mjs';

export function readSearchHistory(projectRoot) {
  const historyPath = resolveWorkspacePaths(projectRoot).searchHistoryPath;
  if (!existsSync(historyPath)) {
    return '# Search History\n\nNo runs yet.\n';
  }

  return readFileSync(historyPath, 'utf8');
}
