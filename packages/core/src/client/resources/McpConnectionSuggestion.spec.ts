import { describe, expect, it } from "vitest";

import { getDefaultMcpIntegrations } from "./mcp-integration-catalog.js";
import {
  findMcpConnectionSuggestionIntegration,
  shouldRenderMcpIntegrationFallback,
} from "./McpConnectionSuggestion.js";

describe("findMcpConnectionSuggestionIntegration", () => {
  it("never promotes integrations from user-authored composer text", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Connect Cloudflare so I can explain this app.",
      }),
    ).toBeNull();
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Send the update to Slack.",
      }),
    ).toBeNull();
  });

  it("allows an explicitly agent-requested connection beside the composer", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Please connect Cloudflare so I can inspect the deployment.",
        requestedByAgent: true,
      })?.id,
    ).toBe("cloudflare");
  });

  it("resolves structured requests only through the trusted integration catalog", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "The agent needs this connection.",
        integrationId: "slack",
      })?.id,
    ).toBe("slack");
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Connect https://untrusted.example/oauth.",
        integrationId: "untrusted-provider",
      }),
    ).toBeNull();
  });

  it("does not select a provider from incidental assistant response text", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Granola is a meeting-notes provider.",
        contextText: "Make the slide title larger.",
        variant: "response",
      }),
    ).toBeNull();
  });

  it("selects a provider from an agent-authored connection request", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "You need to connect to HubSpot before I can pull the deals.",
        contextText: "Summarize my sales pipeline.",
        variant: "response",
      })?.id,
    ).toBe("hubspot");
  });

  it("selects Slack from a concrete authentication failure response", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Slack connection required — please authenticate Slack in Dispatch to continue.",
        contextText:
          "Use Slack auth.test and surface a connection request if needed.",
        variant: "response",
      })?.id,
    ).toBe("slack");
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I couldn’t complete the Slack auth.test call because the Dispatch connection requires authentication.",
        contextText:
          "Use Slack auth.test and surface a connection request if needed.",
        variant: "response",
      })?.id,
    ).toBe("slack");
  });

  it("uses the preceding user mention when the agent asks to connect it", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I don't have access yet - please connect it to continue.",
        contextText: "Pull the latest HubSpot deals.",
        variant: "response",
      })?.id,
    ).toBe("hubspot");
  });

  it("selects response connections only from the user's branded phrase", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I cannot read that page.",
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
    ).toBeUndefined();
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
