import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("editable recording title", () => {
  it("shows an explicit rename affordance on the title", () => {
    const source = readFileSync(
      new URL("./editable-recording-title.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('aria-label={t("editableTitle.editLabel")}');
    expect(source).toContain("cursor-text");
    expect(source).toContain("IconEdit");
  });
});
