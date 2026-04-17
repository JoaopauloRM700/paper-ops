import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readSearchHistory(projectRoot) {
  const historyPath = join(projectRoot, 'data', 'search-history.md');
  if (!existsSync(historyPath)) {
    return '# Search History\n\nNo runs yet.\n';
  }

  return readFileSync(historyPath, 'utf8');
}
