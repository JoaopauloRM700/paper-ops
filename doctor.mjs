#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();

const checks = [
  {
    ok: Number.parseInt(process.versions.node.split('.')[0], 10) >= 18,
    label: `Node.js >= 18 (found ${process.versions.node})`,
  },
  {
    ok: existsSync(join(projectRoot, 'config', 'sources.yml')),
    label: 'config/sources.yml found',
  },
];

for (const directory of ['data', 'reports', 'output', 'batch']) {
  try {
    mkdirSync(join(projectRoot, directory), { recursive: true });
    checks.push({ ok: true, label: `${directory}/ ready` });
  } catch {
    checks.push({ ok: false, label: `${directory}/ could not be created` });
  }
}

let failures = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`OK  ${check.label}`);
  } else {
    console.log(`ERR ${check.label}`);
    failures += 1;
  }
}

process.exit(failures === 0 ? 0 : 1);
