import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("PlanMarkdownEditor inline editing", () => {
  it("uses the shared rich markdown editor instead of a textarea/edit button", () => {
    const source = readSource("./PlanMarkdownEditor.tsx");

    expect(source).toContain("RichMarkdownEditor");
    expect(source).toContain("SAVE_DEBOUNCE_MS");
    expect(source).toContain('preset="plan"');
    expect(source).not.toContain("Textarea");
    expect(source).not.toContain("IconPencil");
  });

  it("threads review-mode edit disabling and source reconciliation metadata", () => {
    const renderer = readSource("./PlanContentRenderer.tsx");
    const documentArea = readSource("./DocumentArea.tsx");

    expect(renderer).toContain("editingDisabled?: boolean");
    expect(renderer).toContain("contentUpdatedAt?: string | null");
    expect(renderer).toContain('op: "update-rich-text"');
    expect(documentArea).toContain("editingDisabled={editingDisabled}");
    expect(documentArea).toContain("contentUpdatedAt={contentUpdatedAt}");
    expect(documentArea).toContain("const canUseInlineEditor");
    expect(documentArea).toContain("editable={editable}");
  });
});
