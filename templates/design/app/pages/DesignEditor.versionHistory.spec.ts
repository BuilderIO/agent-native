import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("DesignEditor version history", () => {
  const editorSource = readDesignEditorSource();
  const rootSource = readFileSync("app/root.tsx", "utf8");
  const eventsSource = readFileSync("app/lib/design-ui-events.ts", "utf8");

  it("keeps ordered undo and redo intents while a grouped delete is pending", () => {
    expect(editorSource).toContain(
      "pendingHistoryDirectionsRef.current.push(direction)",
    );
    expect(editorSource).toContain(
      "clearPendingHistory: clearPendingHistoryDirections",
    );
    expect(editorSource).not.toContain(
      "pendingHistoryDirectionRef.current ??=",
    );
  });

  it("routes inline workbench deletion into the editor history boundary", () => {
    expect(editorSource).toContain("onDeleteInlineFile={");
    expect(editorSource).toContain("await performDeleteFiles([targetFile], {");
    expect(editorSource).toContain("recordDeletionHistory: true,");
  });
});
