import { getDefaultMcpIntegrations } from "@agent-native/core/client/resources/mcp-integration-catalog";
import { describe, expect, it } from "vitest";

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
  });

  it("reads provider names through markdown emphasis", () => {
    for (const [text, id] of [
      ["Please connect **Slack** to continue.", "slack"],
      ["**Slack** isn't connected.", "slack"],
      ["You'll need to connect `Notion` first.", "notion"],
    ] as const) {
      expect(
        findMcpConnectionSuggestionIntegration({ text, variant: "response" })
          ?.id,
      ).toBe(id);
    }
  });

  it("does not read a provider name inside a longer word", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "The NonLinear isn't connected yet.",
        variant: "response",
      }),
    ).toBeNull();
  });

  it("selects a provider whose access is required", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Notion access is required to continue.",
        variant: "response",
      })?.id,
    ).toBe("notion");
  });

  it("selects the provider a real agent reply asks to connect", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Slack isn’t connected, so `auth.test` couldn’t be run. I opened **Settings → Channels → Slack** to surface the connection setup. Connect a Slack workspace there, then I can test it.",
        variant: "response",
      })?.id,
    ).toBe("slack");
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I opened **Settings → Integrations**. Connect Notion there, then tell me when it’s connected and which project page to open.",
        variant: "response",
      })?.id,
    ).toBe("notion");
  });

  it("selects the provider a sent message asks to connect", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Connect Notion and open the project page.",
        variant: "response",
      })?.id,
    ).toBe("notion");
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Can you connect my Slack?",
        variant: "response",
      })?.id,
    ).toBe("slack");
  });

  it("never offers a connection for a prompt that only mentions a provider or links to it", () => {
    const prompt =
      "You are designing a production-ready HTML email for Builder.io. Primary button: Continue your build (href https://www.builder.io/app/projects). Secondary link: More prompt tips. EMAIL-SAFE REQUIREMENTS (HubSpot). If you cannot extract a value, ask me.";
    expect(
      findMcpConnectionSuggestionIntegration({
        text: prompt,
        variant: "response",
      }),
    ).toBeNull();
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "I updated the secondary link. No changes to your copy.",
        contextText: prompt,
        variant: "response",
      }),
    ).toBeNull();
  });

  it("does not read product copy, quoted labels, or look-alike words as a request", () => {
    for (const text of [
      "Build an onboarding flow. Step 3: users can connect Slack from settings to get alerts.",
      "The CTA reads “Connect Slack”.",
      "No need to connect GitHub, here's the diff:",
      "Connect the linear gradient to the hero background.",
      "Connect Linear-style progress bars to each step.",
    ]) {
      expect(
        findMcpConnectionSuggestionIntegration({ text, variant: "response" }),
      ).toBeNull();
    }
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

  it("respects host exclusions for composer and response suggestions", () => {
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Connect Gong so I can query calls.",
        variant: "response",
        excludedIntegrationIds: ["GONG"],
      }),
    ).toBeNull();
    expect(
      findMcpConnectionSuggestionIntegration({
        text: "Please connect your Gong account to continue.",
        contextText: "Query last week's Gong calls.",
        variant: "response",
        excludedIntegrationIds: ["gong"],
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
