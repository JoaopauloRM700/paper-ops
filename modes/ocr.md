# Mode: ocr

Use when the user wants to OCR PDFs from a saved search query.

Behavior:

- reuse saved search exports from `output/*.json`
- reuse cached PDFs from `output/pdfs/` or download direct PDF URLs when available
- write OCR PDF copies to `output/ocr-pdfs/`
- write OCR text to `output/ocr-text/`
- record OCR status in `data/paper-ops.sqlite`
- do not overwrite original PDF artifacts

Inputs:

- saved search query
- optional `--ocr-lang`
- optional `--force`
