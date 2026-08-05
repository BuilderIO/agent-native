import { describe, expect, it } from "vitest";

import { getDefaultMcpIntegrations } from "./mcp-integration-catalog.js";
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

  it("respects integrations excluded by the host app", () => {
    const integrations = getDefaultMcpIntegrations({
      defaults: { exclude: ["hubspot"] },
    });

    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Pull the latest HubSpot deals.",
        integrations,
      }),
    ).toBeNull();
  });
});
