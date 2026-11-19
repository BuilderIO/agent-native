import { describe, expect, it } from "vitest";

import { parseAgentChatReferences } from "./agent-chat-references.js";

describe("parseAgentChatReferences", () => {
  it("preserves valid references and handles absent references", () => {
    const reference = {
      type: "mention",
      path: "github",
      name: "GitHub",
      source: "workspace-integration",
      refType: "integration",
      refId: "github",
    };
    expect(parseAgentChatReferences([reference])).toEqual([reference]);
    expect(parseAgentChatReferences(undefined)).toEqual([]);
  });

  it("rejects malformed references instead of dropping them", () => {
    expect(() =>
      parseAgentChatReferences([
        { type: "unsupported", path: "x", name: "X", source: "test" },
      ]),
    ).toThrow();
    expect(() => parseAgentChatReferences("invalid")).toThrow();
  });
});
