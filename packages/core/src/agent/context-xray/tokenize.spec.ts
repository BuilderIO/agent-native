import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("context tokenization", () => {
  it("keeps the optional server tokenizer outside browser bundles", () => {
    const source = readFileSync(
      new URL("./tokenize.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("import(/* @vite-ignore */ TOKENIZER_MODULE_ID)");
  });
});
