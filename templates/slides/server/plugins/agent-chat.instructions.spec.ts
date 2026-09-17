import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentChatSource = readFileSync(
  new URL("./agent-chat.ts", import.meta.url),
  "utf8",
);

describe("Slides content-edit agent guidance", () => {
  it("keeps content-only edits from changing slide styling", () => {
    expect(
      agentChatSource.match(/For every content-only request/g),
    ).toHaveLength(2);
    expect(agentChatSource).toContain(
      "preserve all existing markup, inline styles, style blocks, backgrounds, and slide-level styling",
    );
  });
});
