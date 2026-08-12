import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorToolbarSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "EditorToolbar.tsx"),
  "utf8",
);
const globalCssSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

describe("EditorToolbar layout contract", () => {
  it("keeps the title input measuring its own width without flex-shrinking", () => {
    expect(editorToolbarSource).toContain(
      'className="min-w-0 max-w-[500px] shrink-0 bg-transparent text-sm font-medium text-foreground/90 outline-none focus:text-foreground"',
    );
    expect(editorToolbarSource).toContain(
      "style={{ width: `${titleInputWidth}px` }}",
    );
  });

  it("leaves the contextual toolbar the full row segment instead of splitting it with a flex spacer", () => {
    expect(editorToolbarSource).toContain('<div className="w-2 shrink-0" />');
    expect(editorToolbarSource).not.toContain(
      '<div className="flex-1 min-w-2" />',
    );
  });

  it("lets the wide contextual toolbar scroll instead of clipping rare overflow", () => {
    expect(globalCssSource).toContain(
      ".deck-editor-context-toolbar-host {\n  min-width: 0;\n  overflow: auto;\n}",
    );
  });
});
