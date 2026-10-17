import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentChatSource = readFileSync(
  new URL("./agent-chat.ts", import.meta.url),
  "utf8",
);

describe("Clips transcript agent guidance", () => {
  it("continues bounded transcripts through every returned offset", () => {
    expect(agentChatSource).toContain(
      "transcriptOffset set to each nextFullTextOffset until that value is null",
    );
    expect(agentChatSource).toContain("interpret the chunks together");
  });
});
