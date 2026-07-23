import { describe, expect, it } from "vitest";

import { findMcpConnectionSuggestionIntegration } from "./McpConnectionSuggestion.js";

describe("findMcpConnectionSuggestionIntegration", () => {
  it("never selects a connection from assistant-authored response text", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I cannot connect to Granola.",
        contextText: "Make the slide title larger.",
        variant: "response",
      }),
    ).toBeNull();
  });

  it("selects response connections only from the user's branded phrase", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I cannot connect to Granola.",
        contextText: "Connect Notion and open the project page.",
        variant: "response",
      })?.id,
    ).toBe("notion");
  });
});
