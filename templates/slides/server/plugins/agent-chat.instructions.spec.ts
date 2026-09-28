import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentChatSource = readFileSync(
  new URL("./agent-chat.ts", import.meta.url),
  "utf8",
);

describe("Slides content-edit agent guidance", () => {
  it("treats a new presentation request as a new deck even in an existing deck chat", () => {
    expect(agentChatSource).toContain(
      "A request to create or generate a presentation starts a new deck even when chat is scoped to an open deck or follows an earlier creation request; edit the open deck only when the user asks to change it.",
    );
  });

  it("keeps content-only edits from changing slide styling", () => {
    expect(
      agentChatSource.match(/For every content-only request/g),
    ).toHaveLength(2);
    expect(agentChatSource).toContain(
      "preserve all existing markup, inline styles, style blocks, backgrounds, and slide-level styling",
    );
  });

  it("batches multi-slide edits and verifies once", () => {
    expect(agentChatSource).toContain(
      "make one get-deck read with compact=false",
    );
    expect(agentChatSource).toContain(
      "Send each matching contentHash as baseContentHash in the same patch-deck call",
    );
    expect(agentChatSource).toContain("Set styleOnly=true for CSS-only");
    expect(agentChatSource).toContain(
      "After the write, verify once with get-deck slideIds and compact=false",
    );
  });
});
