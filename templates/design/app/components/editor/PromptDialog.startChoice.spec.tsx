import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./PromptDialog.tsx", import.meta.url),
  "utf8",
);

describe("New Design start choice", () => {
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
