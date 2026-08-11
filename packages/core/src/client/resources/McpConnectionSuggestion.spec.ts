import { describe, expect, it } from "vitest";

import { getDefaultMcpIntegrations } from "./mcp-integration-catalog.js";
import {
  findMcpConnectionSuggestionIntegration,
  shouldRenderMcpIntegrationFallback,
} from "./McpConnectionSuggestion.js";

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

  it("ignores provider names and URLs inside hidden composer context", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: [
          "Create a deck from this.",
          "<context>",
          "https://drive.google.com/file/d/example",
          "</context>",
        ].join("\n"),
      }),
    ).toBeNull();
  });

  it("ignores provider names and URLs inside hidden response context", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "The deck is updated.",
        contextText: [
          "Create a deck from this.",
          "<context>",
          "Connect Google Drive",
          "</context>",
        ].join("\n"),
        variant: "response",
      }),
    ).toBeNull();
  });

  it("still selects a provider when the user types its URL directly", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Import https://docs.google.com/presentation/d/example",
      })?.id,
    ).toBe("google-workspace");
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

  it("does not render a fallback initial underneath a loaded logo", () => {
    expect(
      shouldRenderMcpIntegrationFallback(
        "data:image/svg+xml;base64,...",
        false,
      ),
    ).toBe(false);
    expect(
      shouldRenderMcpIntegrationFallback("data:image/svg+xml;base64,...", true),
    ).toBe(true);
    expect(shouldRenderMcpIntegrationFallback("", false)).toBe(true);
  });
});
