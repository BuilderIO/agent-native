import { describe, expect, it } from "vitest";

import { googleDocsAdapter } from "./adapters/google-docs.js";
import {
  BUILT_IN_INTEGRATION_CATALOG,
  getIntegrationCatalogEntry,
  listBuiltInChannelIntegrations,
  listIntegrationCatalog,
} from "./catalog.js";
import { BUILT_IN_INTEGRATION_ADAPTER_IDS } from "./plugin.js";

describe("integration catalog", () => {
  it("only seeds runtime-backed messaging channels as built-in", () => {
    expect(listBuiltInChannelIntegrations().map((entry) => entry.id)).toEqual([
      "slack",
      "microsoft-teams",
      "discord",
      "telegram",
      "whatsapp",
      "email",
      "google-docs",
    ]);
    expect(BUILT_IN_INTEGRATION_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "n8n",
          categories: expect.arrayContaining(["automation"]),
          supportMaturity: "built-in",
          automationCapabilities: expect.objectContaining({
            runtime: "configured-webhook",
            invokeWorkflow: true,
          }),
        }),
        expect.objectContaining({
          id: "zapier",
          supportMaturity: "blueprint",
          automationCapabilities: expect.objectContaining({
            runtime: "blueprint-only",
            invokeWorkflow: false,
          }),
        }),
      ]),
    );
  });

  it("preserves source-backed channel caveats and credential alternatives", () => {
    expect(getIntegrationCatalogEntry("slack")?.caveats).toContain(
      "Replies stay in Slack's native message thread when a thread timestamp is available.",
    );
    expect(
      getIntegrationCatalogEntry("slack")?.credentialRequirements.find(
        (credential) => credential.key === "SLACK_BOT_TOKEN",
      ),
    ).toMatchObject({
      label: "Slack Bot Token (legacy)",
      required: false,
      helpText: expect.stringMatching(/Settings → Messaging/),
    });
    expect(getIntegrationCatalogEntry("telegram")?.caveats.join(" ")).toMatch(
      /message_thread_id/i,
    );
    expect(
      getIntegrationCatalogEntry("microsoft-teams")?.caveats.join(" "),
    ).toMatch(/Bot Framework connector/i);
    expect(getIntegrationCatalogEntry("discord")?.caveats.join(" ")).toMatch(
      /does not ingest ordinary server or direct messages/i,
    );
    expect(
      getIntegrationCatalogEntry("discord")?.channelCapabilities,
    ).toMatchObject({
      interactionOnly: true,
      proactiveMessages: false,
    });
    expect(getIntegrationCatalogEntry("whatsapp")?.caveats.join(" ")).toMatch(
      /customer-service conversation window/i,
    );
    expect(getIntegrationCatalogEntry("email")?.caveats.join(" ")).toMatch(
      /not a generic SMTP or IMAP connector/i,
    );
    expect(
      getIntegrationCatalogEntry("email")
        ?.credentialRequirements.filter(
          (credential) => credential.alternativeGroup === "email-provider",
        )
        .map((credential) => credential.key),
    ).toEqual(["RESEND_API_KEY", "SENDGRID_API_KEY"]);
  });

  it("lists every channel adapter the integrations plugin mounts", () => {
    expect(
      listBuiltInChannelIntegrations()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([...BUILT_IN_INTEGRATION_ADAPTER_IDS].sort());
  });

  it("describes Google Docs with the adapter's service account key", () => {
    const googleDocs = getIntegrationCatalogEntry("google-docs");
    expect(googleDocs?.categories).toEqual(["channel"]);
    expect(
      googleDocs?.credentialRequirements.map((credential) => credential.key),
    ).toEqual(
      googleDocsAdapter()
        .getRequiredEnvKeys()
        .map((envKey) => envKey.key),
    );
    // Nobody pastes a Google Docs webhook URL; the poller finds comments.
    expect(googleDocs?.channelCapabilities?.webhookSetup).toBeUndefined();
  });

  it("filters taxonomy without exposing mutable catalog state", () => {
    expect(
      listIntegrationCatalog("tool-protocol").map((entry) => entry.id),
    ).toEqual(["zapier"]);
    expect(listIntegrationCatalog("provider").map((entry) => entry.id)).toEqual(
      ["email"],
    );
    expect(Object.isFrozen(BUILT_IN_INTEGRATION_CATALOG)).toBe(true);
  });
});
