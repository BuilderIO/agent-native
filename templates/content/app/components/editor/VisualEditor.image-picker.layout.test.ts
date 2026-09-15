import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("VisualEditor native image picker", () => {
  it("lets Content validate files instead of filtering them in macOS", () => {
    const source = readFileSync(
      new URL("./VisualEditor.tsx", import.meta.url),
      "utf8",
    );
    const picker = source.match(
      /<input\s+ref=\{imageFileInputRef\}[\s\S]*?aria-hidden="true"\s*\/>/,
    )?.[0];

    expect(picker).toBeDefined();
    expect(picker).not.toContain("accept=");
  });
});
