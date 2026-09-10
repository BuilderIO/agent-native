import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The New Design popover used to drop a user straight into an AI prompt, with
 * the blank-canvas path as a small "Skip to editor" link in the corner. The
 * two are peers now, so the choice comes first.
 */
const source = readFileSync(
  new URL("./PromptDialog.tsx", import.meta.url),
  "utf8",
);

describe("New Design start choice", () => {
  it("presents the two starts as side-by-side cards, AI accented", () => {
    const choice = source.slice(
      source.indexOf("{showStartChoice ? ("),
      source.indexOf('cn("px-2 pb-2"'),
    );
    expect(choice).toContain("grid grid-cols-2");
    expect(choice).toContain("startWithAiHint");
    expect(choice).toContain("startBlankCanvasHint");
    // The AI card carries the accent; the blank one stays plain.
    expect(choice).toContain("--design-editor-accent-color");
  });

  it("opens on the choice, not the prompt", () => {
    expect(source).toContain(
      "const [showStartChoice, setShowStartChoice] = useState(offerStartChoice)",
    );
    expect(source).toContain("data-start-blank-canvas");
    expect(source).toContain("data-start-with-ai");
  });

  it("hides the AI-only controls while the choice is up", () => {
    // Composer, template/design-system row and attachment chips all belong to
    // the AI path; leaving them under the two options is the old popover with
    // a header bolted on.
    expect(source).toContain('cn("px-2 pb-2", showStartChoice && "hidden")');
    const templateRow = source.slice(
      source.indexOf("{!showStartChoice &&"),
      source.indexOf("grid-cols-[minmax(0,1fr)_2.25rem]"),
    );
    expect(templateRow).toContain("onTemplateChange");
    expect(templateRow).toContain("onDesignSystemChange");
  });

  it("drops the corner link when the choice is offered", () => {
    expect(source).toContain("{onSkip && !offerStartChoice && (");
  });

  it("returns to the choice when the popover is reopened", () => {
    expect(source).toContain("setShowStartChoice(offerStartChoice);");
  });

  it("closes on commit rather than after the round trip", () => {
    // Both paths hand off to the editor, which owns the loading state — the
    // popover used to sit over the result until create-and-navigate finished.
    // AI is the first card now, so slice forward from the blank one.
    const blankStart = source.indexOf("data-start-blank-canvas");
    const blank = source.slice(blankStart, blankStart + 1400);
    expect(blank).toContain("onOpenChange(false);");
    const submit = source.slice(
      source.indexOf("const handleSubmit = "),
      source.indexOf("const handleAssetsPickerReady"),
    );
    expect(submit).toContain("onOpenChange(false);");
    // …and comes back if the work fails, so the typed prompt is not lost.
    expect(submit.match(/onOpenChange\(true\)/g) ?? []).toHaveLength(2);
  });
});
