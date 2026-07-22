import { describe, expect, it } from "vitest";

import {
  WORKSPACE_CONNECTION_PROVIDERS,
  getWorkspaceConnectionProvider,
  isWorkspaceConnectionProviderId,
  listWorkspaceConnectionProviders,
  listWorkspaceConnectionProvidersForCapability,
  listWorkspaceConnectionProvidersForTemplate,
  mergeWorkspaceConnectionProviders,
  workspaceConnectionProviderSupports,
} from "./catalog.js";

describe("workspace connection provider catalog", () => {
  it("includes the initial reusable provider set", () => {
    expect(
      WORKSPACE_CONNECTION_PROVIDERS.map((provider) => provider.id),
    ).toEqual([
      "slack",
      "github",
      "figma",
      "notion",
      "gmail",
      "google_drive",
      "hubspot",
      "salesforce",
      "jira",
      "sentry",
      "granola",
      "clips",
      "generic",
    ]);
  });

  it("publishes least-privilege OAuth metadata for creative context providers", () => {
    expect(getWorkspaceConnectionProvider("figma")?.oauth).toMatchObject({
      provider: "figma",
      refreshUrl: "https://api.figma.com/v1/oauth/token",
      scopes: expect.arrayContaining([
        "file_content:read",
        "file_metadata:read",
        "projects:read",
      ]),
    });
    expect(
      getWorkspaceConnectionProvider("google_drive")?.oauth?.scopes,
    ).toEqual(["https://www.googleapis.com/auth/drive.file"]);
    expect(getWorkspaceConnectionProvider("github")?.oauth).toMatchObject({
      provider: "github",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      scopes: expect.arrayContaining(["repo", "read:user", "user:email"]),
    });
    expect(getWorkspaceConnectionProvider("hubspot")?.oauth).toMatchObject({
      provider: "hubspot",
      tokenUrl: "https://api.hubapi.com/oauth/v3/token",
      scopes: expect.arrayContaining([
        "crm.objects.contacts.read",
        "crm.objects.deals.read",
      ]),
    });
    expect(getWorkspaceConnectionProvider("salesforce")?.oauth).toMatchObject({
      provider: "salesforce",
      authorizationUrl:
        "https://login.salesforce.com/services/oauth2/authorize",
      tokenUrl: "https://login.salesforce.com/services/oauth2/token",
      scopes: expect.arrayContaining(["api", "refresh_token", "id"]),
    });
    expect(getWorkspaceConnectionProvider("sentry")?.oauth).toMatchObject({
      provider: "sentry",
      tokenUrl: "https://sentry.io/oauth/token/",
      scopes: expect.arrayContaining(["org:read", "project:read"]),
    });
    expect(getWorkspaceConnectionProvider("jira")?.oauth).toMatchObject({
      authorizationUrl: "https://auth.atlassian.com/authorize",
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      scopes: expect.arrayContaining(["read:jira-work", "offline_access"]),
    });
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

  it("replaces one provider definition without dropping the rest", () => {
    const slack = getWorkspaceConnectionProvider("slack")!;
    const merged = mergeWorkspaceConnectionProviders([
      { ...slack, label: "Acme Slack" },
    ]);

    expect(merged).toHaveLength(WORKSPACE_CONNECTION_PROVIDERS.length);
    expect(merged.find(({ id }) => id === "slack")?.label).toBe("Acme Slack");
    expect(merged.find(({ id }) => id === "github")?.label).toBe("GitHub");
  });

  it("filters providers by template use and capability", () => {
    expect(
      listWorkspaceConnectionProvidersForTemplate("mail").map(
        (provider) => provider.id,
      ),
    ).toEqual(expect.arrayContaining(["gmail", "hubspot"]));

    expect(
      listWorkspaceConnectionProvidersForTemplate("crm").map(
        (provider) => provider.id,
      ),
    ).toEqual(expect.arrayContaining(["hubspot", "salesforce"]));

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
    ).toEqual(["github", "jira"]);
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
