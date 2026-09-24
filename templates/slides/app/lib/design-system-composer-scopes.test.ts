import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("uses each caller's draft scope for both local composer return paths", () => {
  const dialog = readFileSync("app/components/editor/PromptDialog.tsx", "utf8");
  const composer = readFileSync(
    "app/components/editor/SlidesComposerContext.tsx",
    "utf8",
  );
  expect(dialog).toMatch(
    /useSlidesComposerContext\(\s*undefined,\s*undefined,\s*draftScope \?\? title,?\s*\)/,
  );
  expect(composer).toContain(
    "useSlidesComposerContext(deckId, undefined, props.draftScope)",
  );
  expect(composer).toContain(
    "const draftKey = `slides-composer-context:${contextId}`",
  );
});
