import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("editable recording title", () => {
  it("uses the title itself as the rename affordance", () => {
    const source = readFileSync(
      new URL("./editable-recording-title.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('aria-label={t("editableTitle.editLabel")}');
    expect(source).toContain("cursor-text");
    expect(source).not.toContain("IconEdit");
  });
});
