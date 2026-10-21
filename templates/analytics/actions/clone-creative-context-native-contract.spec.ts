import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const templates = path.resolve(here, "../..");

function action(template: string, file: string) {
  return fs.readFileSync(
    path.join(templates, template, "actions", file),
    "utf8",
  );
}

const actions = [
  ["slides", "clone-creative-context-deck.ts"],
  ["design", "clone-creative-context-design-native.ts"],
  ["content", "clone-creative-context-document.ts"],
  ["assets", "clone-creative-context-asset.ts"],
  ["analytics", "clone-creative-context-dashboard.ts"],
] as const;

describe("native Creative Context clone actions", () => {
  it.each(actions)(
    "%s resolves a governed reference and never returns the private handle",
    (template, file) => {
      const source = action(template, file);
      expect(source).toContain("resolveNativeContextCloneReference");
      expect(source).toContain("readPrivateBlob");
      expect(source).toContain("contentHash");
      expect(source).not.toMatch(/return\s+\{[^}]*cloneHandle/s);
    },
  );
});
