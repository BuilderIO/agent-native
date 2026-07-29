import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../pages/DeckEditor.tsx",
  ),
  "utf8",
);

describe("editor side panels", () => {
  it("keeps the style panel closed unless explicitly opened", () => {
    expect(editorSource).toContain("stylePanelOpen = false");
    expect(editorSource).toContain("!readOnly && stylePanelOpen");
  });

  it("uses one mutually exclusive parent state for Style and Comments", () => {
    expect(pageSource).toContain(
      'type EditorSidePanel = "style" | "comments" | null',
    );
    expect(pageSource).toContain(
      'const commentsOpen = sidePanel === "comments"',
    );
    expect(pageSource).toContain('const styleOpen = sidePanel === "style"');
    expect(pageSource).toContain("stylePanelOpen={styleOpen}");
  });
});
