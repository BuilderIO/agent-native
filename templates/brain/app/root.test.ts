import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("command menu shortcut", () => {
  it("opens from the home chat composer, which holds focus on load", () => {
    // The shared hook drops the shortcut while a contenteditable has focus
    // unless the app opts in; the focused home composer made it a dead key.
    const source = readFileSync(join(import.meta.dirname, "root.tsx"), "utf8");
    expect(source).toMatch(
      /useCommandMenuShortcut\([\s\S]*?\{\s*allowContentEditable: true,?\s*\},?\s*\);/,
    );
  });
});
