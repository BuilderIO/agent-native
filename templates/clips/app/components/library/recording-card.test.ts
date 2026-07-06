import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("library recording cards", () => {
  it("do not render inline title editing in the grid card", () => {
    const source = readSource("./recording-card.tsx");

    expect(source).not.toContain("EditableRecordingTitle");
    expect(source).not.toContain("canRenameTitle");
    expect(source).not.toContain("onRename");
    expect(source).not.toContain("IconEdit");
    expect(source).toContain("navigate(recordingPath)");
    expect(source).toContain("select-none text-sm font-medium");
  });

  it("does not pass rename/edit title wiring from the library grid", () => {
    const source = readSource("./library-grid.tsx");

    expect(source).not.toContain("useRenameRecording");
    expect(source).not.toContain("useSession");
    expect(source).not.toContain("openRenameDialog");
    expect(source).not.toContain("renameInputRef");
    expect(source).not.toContain("canRenameTitle");
    expect(source).not.toContain("onRename");
  });
});
