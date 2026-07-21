import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

export function getDefaultDatabasePath(projectRoot = process.cwd()) {
  return join(projectRoot, 'data', 'paper-ops.sqlite');
}

export function openPaperOpsDatabase({ projectRoot = process.cwd(), databasePath } = {}) {
  const resolvedPath = databasePath ?? getDefaultDatabasePath(projectRoot);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

export function runInTransaction(db, work) {
  return db.transaction(work)();
}
