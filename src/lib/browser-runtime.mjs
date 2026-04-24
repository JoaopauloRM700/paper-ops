import { chromium } from 'playwright';

const DEFAULT_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/124.0.0.0 Safari/537.36',
].join(' ');

export async function createPlaywrightBrowserRuntime(config = {}) {
  const browser = await chromium.launch({
    headless: config.browser_headless ?? true,
  });

  const context = await browser.newContext({
    userAgent: config.browser_user_agent ?? DEFAULT_USER_AGENT,
    viewport: {
      width: 1440,
      height: 1280,
    },
  });

  return {
    async runSearch({
      sourceName,
      searchUrl,
      extractor,
      query,
      limit,
      retrievedAt,
      waitForSelector,
      settleTimeMs,
      beforeExtract,
      maxPages,
      pageDelayMs,
    }) {
      const page = await context.newPage();
      const timeoutMs = config.browser_navigation_timeout_ms ?? 30000;
      const effectiveSettleTimeMs = settleTimeMs ?? config.browser_settle_time_ms;

      async function loadPage(url) {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });

        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, {
            timeout: config.browser_result_timeout_ms ?? timeoutMs,
          }).catch(() => {});
        }

        await page.waitForLoadState('networkidle', {
          timeout: Math.min(timeoutMs, 5000),
        }).catch(() => {});

        if (typeof beforeExtract === 'function') {
          await beforeExtract(page);
        }

        if ((effectiveSettleTimeMs ?? 0) > 0) {
          await page.waitForTimeout(effectiveSettleTimeMs);
        }
      }

      try {
        await loadPage(searchUrl);

        return await extractor(page, {
          sourceName,
          query,
          limit,
          retrievedAt,
          loadPage,
          maxPages,
          pageDelayMs,
        });
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
