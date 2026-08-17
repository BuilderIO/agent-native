import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const toolbarSource = readFileSync(
  new URL("./DocumentToolbar.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("./DocumentEditor.tsx", import.meta.url),
  "utf8",
);
const visualEditorSource = readFileSync(
  new URL("./VisualEditor.tsx", import.meta.url),
  "utf8",
);

describe("page history menu", () => {
  it("keeps Undo and Redo in the top-right page menu", () => {
    expect(toolbarSource).toContain("disabled={!canUndo} onSelect={onUndo}");
    expect(toolbarSource).toContain("disabled={!canRedo} onSelect={onRedo}");
    expect(toolbarSource).toContain('t("editor.toolbar.undo")');
    expect(toolbarSource).toContain('t("editor.toolbar.redo")');
  });

  it("routes menu history commands through the live visual editor", () => {
    expect(editorSource).toContain(
      "editorHistoryControllerRef.current?.undo()",
    );
    expect(editorSource).toContain(
      "editorHistoryControllerRef.current?.redo()",
    );
    expect(visualEditorSource).toContain(
      "tr.setMeta(LOCAL_FILE_USER_EDIT_META, true)",
    );
  });

  it("keeps stale local title and body edits behind the observed disk revision", () => {
    expect(editorSource).toContain("baseline.document.content !==");
    expect(editorSource).toContain("lastSavedContentRef.current.content");
    expect(editorSource).toContain(
      "baseline.document.title !== lastSavedTitleRef.current.title",
    );
    expect(editorSource).toContain('t("editor.copyUnsavedText")');
    expect(editorSource).toContain('t("editor.useDiskVersion")');
  });
});
