import { readFileSync } from "node:fs";

import { countTokens } from "@anthropic-ai/tokenizer";
import { describe, expect, it } from "vitest";

import { countTextTokens } from "./tokenize.js";

describe("context tokenization", () => {
  it("keeps the optional server tokenizer outside browser bundles", () => {
    const source = readFileSync(
      new URL("./tokenize.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("import(/* @vite-ignore */ TOKENIZER_MODULE_ID)");
  });

  it("counts exactly what the package counts while reusing one encoder", async () => {
    for (const text of [
      "",
      "hello world",
      "ﬁ ligature Ａ fullwidth",
      "<|endoftext|> special",
      "<div style='color:#647968'>Make more plants</div>".repeat(40),
    ]) {
      expect(await countTextTokens(text)).toEqual({
        tokens: Math.max(1, countTokens(text)),
        method: "exact",
      });
    }
  });
});
