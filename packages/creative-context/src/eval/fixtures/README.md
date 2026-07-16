# Creative Context acceptance fixtures

This corpus is intentionally realistic and deterministic. It contains two
revisions of a three-slide PPTX (including notes and an embedded 320x180 image),
two Figma file revisions, a recursive Notion export, a JavaScript-rendered brand
page, and two 320x180 image references.

The corpus also includes duplicates, deprecated examples, cross-revision stable
IDs, signed media URLs, and prompt-injection strings. Those strings are inert
test data; acceptance reports must treat them as forbidden output, never as
instructions.

Regenerate only the binary fixtures from the package directory:

```sh
pnpm exec tsx scripts/generate-eval-fixtures.ts
```
