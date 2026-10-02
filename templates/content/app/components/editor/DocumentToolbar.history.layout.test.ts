import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
const editorSource = readFileSync(
  new URL("./DocumentEditor.tsx", import.meta.url),
  "utf8",
);

describe("page history menu", () => {
  it("keeps stale local title and body edits behind the observed disk revision", () => {
    expect(editorSource).toContain("baseline.document.content !==");
    expect(editorSource).toContain("lastSavedContentRef.current.content");
    expect(editorSource).toContain(
      "baseline.document.title !== lastSavedTitleRef.current.title",
    );
    expect(editorSource).toContain('t("editor.copyUnsavedText")');
    expect(editorSource).toContain("writeClipboardText(");
    expect(editorSource).toContain('t("editor.useDiskVersion")');
  });
});
