import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

function readSource(relative: string): string {
  return readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), relative),
    "utf8",
  );
}

describe("motion empty-track persistence (Item 2)", () => {
  const editorSrc = readDesignEditorSource();
  const autosaveSrc = readSource("./design-editor/effects/motion-autosave.ts");

  it("wires the remove-motion-timeline action mutation", () => {
    expect(editorSrc).toContain("useActionMutation(");
    expect(editorSrc).toContain('"remove-motion-timeline"');
    expect(editorSrc).toContain("removeMotionTimelineMutation");
  });
});
