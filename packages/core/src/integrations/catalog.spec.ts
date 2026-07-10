import { describe, expect, it } from "vitest";

import {
  BUILT_IN_INTEGRATION_CATALOG,
  getIntegrationCatalogEntry,
  listBuiltInChannelIntegrations,
  listIntegrationCatalog,
} from "./catalog.js";

describe("integration catalog", () => {
  it("only seeds runtime-backed messaging channels as built-in", () => {
    expect(listBuiltInChannelIntegrations().map((entry) => entry.id)).toEqual([
      "slack",
      "telegram",
      "whatsapp",
      "email",
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
    expect(getIntegrationCatalogEntry("telegram")?.caveats.join(" ")).toMatch(
      /does not model forum topics/i,
    );
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
