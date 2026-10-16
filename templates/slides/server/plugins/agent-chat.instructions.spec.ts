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
    expect(agentChatSource).toContain(
      "After the write, verify once with get-deck slideIds and compact=false",
    );
  });

  it("removes visual objects without deleting slides", () => {
    expect(agentChatSource).toContain(
      "Removing boxes, headers, or other objects is an in-slide edit: preserve slide count, order, and IDs, and use update-slide or patch-deck with patch-slide operations; use delete-slide only when the user explicitly asks to remove a slide.",
    );
  });

  it("uses web search for factual slide research", () => {
    expect(agentChatSource).toContain(
      'call tool-search with names ["web-search", "web-request"] to load both tools, even when the user gives only a name or domain',
    );
    expect(agentChatSource).toContain(
      "Then call web-search to find sources and web-request to read the most relevant public pages before writing factual claims to slides.",
    );
    expect(agentChatSource).toContain(
      "If tool-search cannot find either tool, or a tool reports a missing backend or an error, tell the user exactly what failed.",
    );
  });
});
