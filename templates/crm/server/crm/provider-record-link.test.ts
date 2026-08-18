import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  resolved: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ scoped: true })),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: vi.fn(async () => state.resolved),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => [] }) }) }),
  schema: {
    crmRecords: {},
    crmRecordShares: {},
    crmConnections: {},
    crmConnectionShares: {},
  },
}));

import {
  buildProviderRecordUrl,
  resolveProviderRecordLink,
} from "./provider-record-link.js";

describe("buildProviderRecordUrl", () => {
  it("builds a HubSpot record link from the portal id and object type id", () => {
    expect(
      buildProviderRecordUrl({
        provider: "hubspot",
        objectType: "deals",
        remoteId: "31337",
        portalId: "1234567",
      }),
    ).toEqual({
      available: true,
      url: "https://app.hubspot.com/contacts/1234567/record/0-3/31337",
    });
  });

  it("passes a HubSpot custom object type id straight through", () => {
    expect(
      buildProviderRecordUrl({
        provider: "hubspot",
        objectType: "2-4591",
        remoteId: "42",
        portalId: "1234567",
      }),
    ).toMatchObject({
      url: "https://app.hubspot.com/contacts/1234567/record/2-4591/42",
    });
  });

  it("builds a Salesforce Lightning record link from the instance origin", () => {
    expect(
      buildProviderRecordUrl({
        provider: "salesforce",
        objectType: "Opportunity",
        remoteId: "0065g00000ABCdEAAV",
        instanceUrl: "https://builder.my.salesforce.com",
      }),
    ).toEqual({
      available: true,
      url: "https://builder.my.salesforce.com/lightning/r/Opportunity/0065g00000ABCdEAAV/view",
    });
  });

  it("reports a typed reason instead of guessing a URL", () => {
    expect(
      buildProviderRecordUrl({
        provider: "hubspot",
        objectType: "deals",
        remoteId: "31337",
        portalId: null,
      }),
    ).toEqual({ available: false, reason: "missing-portal-id" });
    expect(
      buildProviderRecordUrl({
        provider: "hubspot",
        objectType: "invoices",
        remoteId: "31337",
        portalId: "1234567",
      }),
    ).toEqual({ available: false, reason: "unsupported-object-type" });
    expect(
      buildProviderRecordUrl({
        provider: "salesforce",
        objectType: "Opportunity",
        remoteId: "0065g00000ABCdEAAV",
        instanceUrl: null,
      }),
    ).toEqual({ available: false, reason: "missing-instance-url" });
  });

  it("refuses an untrusted or malformed Salesforce origin", () => {
    for (const instanceUrl of [
      "http://builder.my.salesforce.com",
      "https://builder.my.salesforce.com.evil.test",
      "https://builder.my.salesforce.com:8443",
      "not a url",
    ]) {
      expect(
        buildProviderRecordUrl({
          provider: "salesforce",
          objectType: "Opportunity",
          remoteId: "0065g00000ABCdEAAV",
          instanceUrl,
        }),
      ).toEqual({ available: false, reason: "missing-instance-url" });
    }
  });

  it("refuses a remote id that is not a provider record id", () => {
    expect(
      buildProviderRecordUrl({
        provider: "salesforce",
        objectType: "Opportunity",
        remoteId: "../../lightning/setup",
        instanceUrl: "https://builder.my.salesforce.com",
      }),
    ).toEqual({ available: false, reason: "invalid-remote-id" });
    expect(
      buildProviderRecordUrl({
        provider: "hubspot",
        objectType: "deals",
        remoteId: "31337/../settings",
        portalId: "1234567",
      }),
    ).toEqual({ available: false, reason: "invalid-remote-id" });
  });
});

describe("resolveProviderRecordLink", () => {
  beforeEach(async () => {
    state.resolved = {};
    const { resolveWorkspaceConnectionForApp } =
      await import("@agent-native/core/workspace-connections");
    vi.mocked(resolveWorkspaceConnectionForApp).mockClear();
  });

  it("reads the Salesforce instance origin from the workspace connection", async () => {
    state.resolved = {
      available: true,
      connection: {
        config: { salesforceInstanceUrl: "https://builder.my.salesforce.com" },
      },
    };
    await expect(
      resolveProviderRecordLink({
        provider: "salesforce",
        objectType: "Account",
        remoteId: "0015g00000ABCdEAAV",
        accountId: "00Dexample",
        workspaceConnectionId: "workspace-1",
      }),
    ).resolves.toEqual({
      available: true,
      url: "https://builder.my.salesforce.com/lightning/r/Account/0015g00000ABCdEAAV/view",
    });
  });

  it("distinguishes an unavailable connection from a missing instance URL", async () => {
    state.resolved = { available: false, connection: null, reason: "no-grant" };
    await expect(
      resolveProviderRecordLink({
        provider: "salesforce",
        objectType: "Account",
        remoteId: "0015g00000ABCdEAAV",
        accountId: "00Dexample",
        workspaceConnectionId: "workspace-1",
      }),
    ).resolves.toEqual({
      available: false,
      reason: "workspace-connection-unavailable",
    });

    state.resolved = { available: true, connection: { config: {} } };
    await expect(
      resolveProviderRecordLink({
        provider: "salesforce",
        objectType: "Account",
        remoteId: "0015g00000ABCdEAAV",
        accountId: "00Dexample",
        workspaceConnectionId: "workspace-1",
      }),
    ).resolves.toEqual({ available: false, reason: "missing-instance-url" });
  });

  it("never asks the workspace store for a HubSpot link", async () => {
    const { resolveWorkspaceConnectionForApp } =
      await import("@agent-native/core/workspace-connections");
    await expect(
      resolveProviderRecordLink({
        provider: "hubspot",
        objectType: "companies",
        remoteId: "9001",
        accountId: "1234567",
        workspaceConnectionId: "workspace-1",
      }),
    ).resolves.toMatchObject({
      url: "https://app.hubspot.com/contacts/1234567/record/0-2/9001",
    });
    expect(resolveWorkspaceConnectionForApp).not.toHaveBeenCalled();
  });
});
