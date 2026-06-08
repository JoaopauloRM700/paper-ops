import { runAcmSearch } from './acm.mjs';
import { runGoogleScholarSearch } from './google-scholar.mjs';
import { runIeeeSearch } from './ieee.mjs';
import { runScieloSearch } from './scielo.mjs';
import { runScopusSearch } from './scopus.mjs';
import { runWebOfScienceSearch } from './web-of-science.mjs';

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
    case 'scielo':
      return runScieloSearch(context);
    case 'web_of_science':
      return runWebOfScienceSearch(context);
    default:
      return {
        source: sourceName,
        status: 'skipped',
        reason: `Unknown source: ${sourceName}`,
        records: [],
      };
  }
}
