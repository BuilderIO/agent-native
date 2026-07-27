import { describe, expect, it } from "vitest";

import { parseNfmForEditor, serializeEditorToNfm } from "./notion-markdown";

describe("equation roundtrip", () => {
  it.fails("preserves block equations through NFM parse/serialize", () => {
    const storage = "$$\nx^2\n$$";
    const editorMarkdown = parseNfmForEditor(storage);
    const restored = serializeEditorToNfm(editorMarkdown);

    expect(restored).toBe(storage);
  });
});
