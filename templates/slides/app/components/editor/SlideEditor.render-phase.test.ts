import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exiting inline edit used to flush `onUpdateSlide` (and mutate the edited
 * DOM node) from inside a `setEditingEl` updater. Updaters run in the render
 * phase, so the flush updated DeckProvider while SlideEditor was rendering:
 * "Cannot update a component (DeckProvider) while rendering a different
 * component (SlideEditor)". `editingElRef` exists so exit paths can read the
 * edited element outside render; these assertions are what stop the updater
 * shape from coming back.
 */
const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);

describe("SlideEditor render-phase safety", () => {
  it("never passes an updater function to setEditingEl", () => {
    const updaterCalls = source.match(
      /setEditingEl\(\s*(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/g,
    );
    expect(updaterCalls).toBeNull();
  });

  it("never flushes onUpdateSlide from inside a setState updater", () => {
    const offenders = [
      ...source.matchAll(
        /set[A-Z][\w$]*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      ),
    ].filter((match) => {
      const body = source.slice(match.index, match.index + 600);
      return body.includes("onUpdateSlideRef");
    });
    expect(offenders.map((m) => m[0])).toEqual([]);
  });
});
