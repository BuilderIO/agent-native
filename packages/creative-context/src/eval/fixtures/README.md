# Creative Context acceptance fixtures

This corpus is deterministic. It contains two revisions of a three-slide PPTX
(including notes and an embedded 320x180 image), a pair of locally authored
synthetic provider-response fixtures for the Figma connector, a recursive Notion
export, a JavaScript-rendered brand page, and two 320x180 image references.

The connector fixtures use locally chosen names, identifiers, text, and colors
with stable node IDs across revisions. They preserve the provider response shape
needed by the interoperability parser; they are not account exports or captured
files.

The corpus also includes duplicates, deprecated examples, cross-revision stable
IDs, signed media URLs, and prompt-injection strings. Those strings are inert
test data; acceptance reports must treat them as forbidden output, never as
instructions.

The command below regenerates only the binary fixtures from the package directory:

```sh
pnpm exec tsx scripts/generate-eval-fixtures.ts
```
