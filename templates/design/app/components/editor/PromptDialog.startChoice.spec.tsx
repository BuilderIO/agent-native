import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./PromptDialog.tsx", import.meta.url),
  "utf8",
);

describe("New Design start choice", () => {
  it("presents the two starts as side-by-side cards, AI accented", () => {
    const choice = source.slice(
      source.indexOf("{showStartChoice ? ("),
      source.indexOf('cn(!inline && "px-2 pb-2"'),
    );
    expect(choice).toContain("grid grid-cols-2");
    expect(choice).toContain("startWithAiHint");
    expect(choice).toContain("startBlankCanvasHint");
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
    expect(source).toContain(
      'cn(!inline && "px-2 pb-2", showStartChoice && "hidden")',
    );
    const templateRow = source.slice(
      source.indexOf("{!inline &&"),
      source.indexOf("grid-cols-[minmax(0,1fr)_2.25rem]"),
    );
    expect(templateRow).toContain("onTemplateChange");
    expect(templateRow).toContain("onDesignSystemChange");
  });

  it("drops the corner link when the choice is offered", () => {
    expect(source).toContain(
      "{onSkip && skipLabel && !inline && !offerStartChoice && (",
    );
    expect(source).not.toContain('t("promptDialog.skipPrompt")');
  });

  it("returns to the choice when the popover is reopened", () => {
    expect(source).toContain("setShowStartChoice(offerStartChoice);");
  });

  it("closes on commit rather than after the round trip", () => {
    const blankStart = source.indexOf("data-start-blank-canvas");
    const blank = source.slice(blankStart, blankStart + 1400);
    expect(blank).toContain("onOpenChange(false);");
    const submit = source.slice(
      source.indexOf("const handleSubmit = "),
      source.indexOf("const hasLiveVirtualAnchor"),
    );
    expect(submit).toContain("onOpenChange(false);");
    expect(submit.match(/onOpenChange\(true\)/g) ?? []).toHaveLength(2);
  });
});
