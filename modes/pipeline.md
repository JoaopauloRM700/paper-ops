# Mode: pipeline

Process queued search strings from `data/search-queue.md`.

Expected queue item format:

```markdown
- [ ] ("systematic review" AND rag) AND ieee
```

After processing, summarize how many searches ran and where each saved report was written.
