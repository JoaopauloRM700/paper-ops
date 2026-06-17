import { createPlaywrightBrowserRuntime } from './src/lib/browser-runtime.mjs';
import fs from 'node:fs';

async function debug() {
  const runtime = await createPlaywrightBrowserRuntime({ browser_headless: true });
  const query = 'software testing';
  const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
  const records = await runtime.runSearch({
    sourceName: 'google_scholar',
    searchUrl: url,
    extractor: async (page) => {
        const html = await page.content();
        fs.writeFileSync('scholar_debug.html', html, 'utf8');
        return [];
    },
    query,
    limit: 1,
    retrievedAt: new Date().toISOString()
  });
  await runtime.close();
}

debug();
