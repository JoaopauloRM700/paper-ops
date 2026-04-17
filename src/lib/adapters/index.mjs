import { runAcmSearch } from './acm.mjs';
import { runGoogleScholarSearch } from './google-scholar.mjs';
import { runIeeeSearch } from './ieee.mjs';
import { runScopusSearch } from './scopus.mjs';

export async function runSourceSearch(sourceName, context) {
  switch (sourceName) {
    case 'scopus':
      return runScopusSearch(context);
    case 'ieee':
      return runIeeeSearch(context);
    case 'acm':
      return runAcmSearch(context);
    case 'google_scholar':
      return runGoogleScholarSearch(context);
    default:
      return {
        source: sourceName,
        status: 'skipped',
        reason: `Unknown source: ${sourceName}`,
        records: [],
      };
  }
}
