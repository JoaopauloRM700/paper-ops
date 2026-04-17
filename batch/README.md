# Batch

`paper-ops batch` processes the TSV input in `batch-input.tsv` from the Node runtime.

For resumable shell-based orchestration, use:

```bash
bash batch/batch-runner.sh --fixtures
```

Input format:

```tsv
id	query	notes
1	("systematic review" AND "retrieval augmented generation")	fixture smoke search
2	("knowledge graph" AND screening)	acm focus
```

Runtime artifacts:

- `batch/batch-state.tsv`
- `batch/logs/`

Use `--fixtures` for deterministic local validation.
