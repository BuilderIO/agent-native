import { describe, expect, it } from "vitest";

import {
  WORKSPACE_CONNECTION_PROVIDERS,
  getWorkspaceConnectionProvider,
  isWorkspaceConnectionProviderId,
  listWorkspaceConnectionProviders,
  listWorkspaceConnectionProvidersForCapability,
  listWorkspaceConnectionProvidersForTemplate,
  workspaceConnectionProviderSupports,
} from "./catalog.js";

describe("workspace connection provider catalog", () => {
  it("includes the initial reusable provider set", () => {
    expect(
      WORKSPACE_CONNECTION_PROVIDERS.map((provider) => provider.id),
    ).toEqual([
      "slack",
      "github",
      "notion",
      "gmail",
      "google_drive",
      "hubspot",
      "granola",
      "clips",
      "generic",
    ]);
  });

  it("looks up providers and narrows provider ids", () => {
    expect(isWorkspaceConnectionProviderId("slack")).toBe(true);
    expect(isWorkspaceConnectionProviderId("unknown")).toBe(false);
    expect(getWorkspaceConnectionProvider("github")).toMatchObject({
      id: "github",
      label: "GitHub",
      capabilities: expect.arrayContaining(["code", "search"]),
    });
  });

  it("filters providers by template use and capability", () => {
    expect(
      listWorkspaceConnectionProvidersForTemplate("mail").map(
        (provider) => provider.id,
      ),
    ).toEqual(expect.arrayContaining(["gmail", "hubspot"]));

    expect(
      listWorkspaceConnectionProvidersForCapability("meetings").map(
        (provider) => provider.id,
      ),
    ).toEqual(expect.arrayContaining(["granola", "clips"]));

    expect(
      listWorkspaceConnectionProviders({
        templateUse: "brain",
        capability: "code",
      }).map((provider) => provider.id),
    ).toEqual(["github"]);
  });

  it("checks provider capabilities without exposing credential values", () => {
    expect(workspaceConnectionProviderSupports("slack", "messages")).toBe(true);
    expect(workspaceConnectionProviderSupports("slack", "crm")).toBe(false);

    for (const provider of WORKSPACE_CONNECTION_PROVIDERS) {
      for (const credential of provider.credentialKeys) {
        expect(credential).not.toHaveProperty("value");
        expect(credential).not.toHaveProperty("secret");
        expect(credential.key).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });
});
