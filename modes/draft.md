# Mode: draft

Use when the user wants a sourced draft section from indexed evidence.

Behavior:

- retrieve evidence chunks for the provided focus question
- produce a Markdown draft with source labels beside each grounded claim
- list the sources used

Inputs:

- saved search query
- `--question "<focus>"`
- optional `--section "<name>"`
- optional `--top-k <number>`
