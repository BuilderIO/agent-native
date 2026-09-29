import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getProviderApiConfig,
  listProviderApiCatalog,
  listProviderApiIdsForTemplateUse,
} from "./provider-api-definitions.js";
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForCapability,
} from "./workspace-connections.js";

describe("ejected catalog wrappers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves caller workspace overrides in direct and filtered helpers", () => {
    const slack = getWorkspaceConnectionProvider("slack")!;
    const override = {
      ...slack,
      label: "App-owned Slack",
      capabilities: ["docs" as const],
    };

    expect(getWorkspaceConnectionProvider("slack", [override])?.label).toBe(
      "App-owned Slack",
    );
    expect(
      listWorkspaceConnectionProvidersForCapability("docs", [override]).find(
        (provider) => provider.id === "slack",
      )?.label,
    ).toBe("App-owned Slack");
  });

  it("preserves caller provider API overrides across catalog helpers", () => {
    const sentry = getProviderApiConfig("sentry");
    const override = {
      ...sentry,
      label: "App-owned Sentry",
      templateUses: ["mail" as const],
    };

    expect(getProviderApiConfig("sentry", [override]).label).toBe(
      "App-owned Sentry",
    );
    expect(
      listProviderApiCatalog("sentry", {
        providerOverrides: [override],
      })[0]?.label,
    ).toBe("App-owned Sentry");
    expect(listProviderApiIdsForTemplateUse("mail", [override])).toContain(
      "sentry",
    );
  });
});
