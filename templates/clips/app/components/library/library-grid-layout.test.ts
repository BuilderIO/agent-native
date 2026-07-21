import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("selected library actions layout", () => {
  it("anchors the action bar to the list viewport instead of the list end", () => {
    const gridSource = readSource("./library-grid.tsx");
    const toolbarSource = readSource("./bulk-action-toolbar.tsx");

    expect(gridSource).toContain(
      'className="relative flex min-h-0 flex-1 overflow-hidden"',
    );
    expect(gridSource).toContain(
      'className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4"',
    );
    expect(gridSource).toContain('selected.size > 0 && "pb-20"');
    expect(toolbarSource).not.toContain("sticky bottom-4");
  });

  it("moves clips into folders created from either move menu", () => {
    const gridSource = readSource("./library-grid.tsx");
    const toolbarSource = readSource("./bulk-action-toolbar.tsx");

    expect(gridSource).toContain("CreateFolderDialog");
    expect(gridSource).toContain("createFolderTarget");
    expect(gridSource).toContain('kind: \"single\"');
    expect(gridSource).toContain('kind: \"bulk\"');
    expect(gridSource).toContain(
      "moveRecordings(createFolderTarget.recordingIds",
    );
    expect(toolbarSource).toContain("onCreateFolder");
    expect(toolbarSource).toContain('t(\"navigation.newFolder\")');
  });
});
