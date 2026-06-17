import fs from 'node:fs';
import path from 'node:path';
import { extractTextFromPdfFile } from './src/lib/pdf-extractor.mjs';

const targetDir = 'output/pdfs/bilingual-search-2026-06-17';

async function renamePdfs() {
  if (!fs.existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    return;
  }

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.pdf'));
  console.log(`Processing ${files.length} files...`);

  for (const file of files) {
    const filePath = path.join(targetDir, file);
    
    if (file.includes(' - ') || file.startsWith('[')) continue;

    try {
      const text = await extractTextFromPdfFile(filePath, { minimumCharacters: 10 });
      
      // Get the first few non-empty lines to guess the title
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 15);
      const title = lines[0] || 'Unknown Title';

      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const newName = `${safeTitle} - ${file}`;
      const newPath = path.join(targetDir, newName);

      if (safeTitle && safeTitle !== 'Unknown Title') {
          console.log(`Renaming: ${file} -> ${newName}`);
          fs.renameSync(filePath, newPath);
      } else {
          console.log(`Could not determine title for ${file}`);
      }
    } catch (error) {
      console.error(`Error processing ${file}: ${error.message}`);
    }
  }
}

renamePdfs();
