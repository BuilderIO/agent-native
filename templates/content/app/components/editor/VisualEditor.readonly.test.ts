import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readEditorSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("VisualEditor read-only mode", () => {
  it("renders toggle titles as plain text when editing is disabled", () => {
    const source = readEditorSource("./extensions/NotionExtensions.tsx");

    expect(source).toContain("const isEditable = editor.isEditable");
    expect(source).toMatch(
      /\{isEditable \? \(\s*<input[\s\S]*className="notion-toggle__summary"[\s\S]*\) : \(\s*<span className="notion-toggle__summary" contentEditable=\{false\}>/,
    );
  });

  it("gates the custom drag handle behind editor editability", () => {
    const source = readEditorSource("./extensions/DragHandle.tsx");

    expect(source).toContain("const editor = this.editor");
    expect(source).toContain("el.draggable = false");
    expect(source).toMatch(
      /handle\.addEventListener\("mousedown", \(e\) => \{\s*e\.stopPropagation\(\);\s*if \(!editor\.isEditable\) \{\s*e\.preventDefault\(\);/,
    );
    expect(source).not.toMatch(
      /handle\.addEventListener\("mousedown", \(e\) => \{\s*e\.preventDefault\(\);\s*if \(!editor\.isEditable\)/,
    );
    expect(source).toContain(
      'document.addEventListener("mousemove", handleDocumentMouseMove);',
    );
    expect(source).toContain('line.className = "notion-drop-indicator";');
    expect(source).toContain(
      'session.sourceBlock.classList.add("notion-block--dragging");',
    );
    expect(source).toContain("session.view.dispatch(tr.scrollIntoView());");
  });
});
