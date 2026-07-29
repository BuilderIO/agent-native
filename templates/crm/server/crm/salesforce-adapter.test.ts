import { describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({
  resolveConnection: vi.fn(),
  resolveCredential: vi.fn(),
}));
const providerApi = vi.hoisted(() => ({ resolveOAuth: vi.fn() }));

vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: workspace.resolveConnection,
  resolveWorkspaceConnectionCredentialForApp: workspace.resolveCredential,
}));
vi.mock("@agent-native/core/provider-api", () => ({
  resolveProviderApiOAuthAccessToken: providerApi.resolveOAuth,
}));

import {
  createSalesforceCrmAdapter,
  salesforceRetryDelayMs,
  SalesforceCrmAdapter,
  type SalesforceTransport,
} from "./salesforce-adapter.js";

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "salesforce-connection",
    provider: "salesforce",
    label: "Builder Sales Cloud",
    accountId: "00Dexample",
    accountLabel: "Example org",
    status: "connected",
    scopes: ["api", "crm.objects.opportunity.write"],
    config: {
      credentialMode: "oauth",
      salesforceInstanceUrl: "https://builder.my.salesforce.com",
      salesforceIdentityUrl:
        "https://login.salesforce.com/id/00Dexample/005example",
      salesforceOrganizationId: "00Dexample",
    },
    allowedApps: ["crm"],
    credentialRefs: [{ key: "SALESFORCE_ACCESS_TOKEN", scope: "user" }],
    ownerEmail: "owner@example.test",
    orgId: "org-42",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    appAccess: {
      appId: "crm",
      available: true,
      mode: "explicit-grant",
      reason: "Granted to CRM",
      grantId: "grant-42",
    },
    explicitGrant: {
      id: "grant-42",
      connectionId: "salesforce-connection",
      provider: "salesforce",
      appId: "crm",
      scopes: [],
      config: {},
      credentialRefs: [],
      grantedByEmail: "owner@example.test",
      ownerEmail: "owner@example.test",
      orgId: "org-42",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    },
    ...overrides,
  } as any;
}

function transport(
  handler: (input: any) =>
    | { status: number; body?: unknown; headers?: Record<string, string> }
    | Promise<{
        status: number;
        body?: unknown;
        headers?: Record<string, string>;
      }>,
) {
  return { request: vi.fn(handler) } satisfies SalesforceTransport;
}

function adapter(
  mockTransport: SalesforceTransport,
  overrides: Record<string, unknown> = {},
) {
  return new SalesforceCrmAdapter({
    connection: connection(overrides),
    transport: mockTransport,
  });
}

const opportunityDescription = {
  name: "Opportunity",
  label: "Opportunity",
  labelPlural: "Opportunities",
  queryable: true,
  searchable: true,
  createable: true,
  updateable: true,
  deletable: true,
  fields: [
    {
      name: "Name",
      label: "Opportunity Name",
      type: "string",
      accessible: true,
      createable: true,
      updateable: true,
      nillable: false,
    },
    {
      name: "Amount",
      label: "Amount",
      type: "currency",
      accessible: true,
      createable: true,
      updateable: true,
      nillable: true,
    },
    {
      name: "Secret__c",
      label: "Secret",
      type: "string",
      accessible: true,
      encrypted: true,
    },
    {
      name: "AccountId",
      label: "Account",
      type: "reference",
      accessible: true,
      referenceTo: ["Account"],
    },
  ],
};

describe("SalesforceCrmAdapter", () => {
  it("honors Retry-After and a bounded retry budget", () => {
    expect(
      salesforceRetryDelayMs(
        { status: 429, headers: { "Retry-After": "0.2" } },
        0,
        0,
        0,
      ),
    ).toBe(200);
    expect(
      salesforceRetryDelayMs(
        {
          status: 503,
          headers: { "retry-after": new Date(2_000).toUTCString() },
        },
        0,
        0,
        1_000,
      ),
    ).toBe(1_000);
    expect(salesforceRetryDelayMs({ status: 429 }, 2, 1_400, 0)).toBe(100);
  });

  it("retries safe Salesforce reads after a rate limit", async () => {
    vi.useFakeTimers();
    const mockTransport = transport(
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 429,
          headers: { "retry-after": "0.1" },
        })
        .mockResolvedValueOnce({ status: 200, body: opportunityDescription }),
    );
    const result = adapter(mockTransport).describeObject("Opportunity");
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({ objectType: "Opportunity" });
    expect(mockTransport.request).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("projects only allow-listed fields and preserves Salesforce revisions and query locators", async () => {
    const mockTransport = transport((input) => {
      if (input.path === "/sobjects/Opportunity/describe") {
        return { status: 200, body: opportunityDescription };
      }
      expect(input.path).toContain("/queryAll?q=");
      expect(decodeURIComponent(input.path)).toContain(
        "SELECT Id,SystemModstamp,LastModifiedDate,IsDeleted,Name,Amount FROM Opportunity",
      );
      return {
        status: 200,
        body: {
          records: [
            {
              Id: "006example",
              SystemModstamp: "2026-07-21T01:02:03.000+0000",
              IsDeleted: true,
              Name: "Renewal",
              Amount: 1000,
              Secret__c: "must not escape",
            },
          ],
          done: false,
          nextRecordsUrl: "/services/data/v60.0/query/01gexample-2000",
        },
      };
    });
    const result = await adapter(mockTransport).syncPage({
      scope: { objectType: "Opportunity", includeDeleted: true },
      fieldAllowList: ["Name", "Amount"],
      limit: 25,
    });

    expect(result).toMatchObject({ complete: false });
    expect(result.nextCursor).toBeTruthy();
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      ref: { remoteId: "006example", objectType: "Opportunity" },
      fields: { Name: "Renewal", Amount: 1000 },
      deleted: true,
      remoteRevision: "2026-07-21T01:02:03.000+0000",
      accessScope: {
        key: "salesforce-connection:grant-42",
        recordVisibility: "actor",
      },
    });
    expect(result.records[0]!.fields).not.toHaveProperty("Secret__c");
  });

  it("builds Contact display names from the default mirror fields", async () => {
    const crm = adapter(
      transport((input) => {
        if (input.path === "/sobjects/Contact/describe") {
          return {
            status: 200,
            body: {
              name: "Contact",
              fields: [
                { name: "FirstName", type: "string", accessible: true },
                { name: "LastName", type: "string", accessible: true },
                { name: "Email", type: "email", accessible: true },
              ],
            },
          };
        }
        return {
          status: 200,
          body: {
            records: [
              {
                Id: "003example",
                FirstName: "Ada",
                LastName: "Lovelace",
                Email: "ada@example.test",
              },
            ],
            done: true,
          },
        };
      }),
    );

    const result = await crm.syncPage({
      scope: { objectType: "Contact" },
      fieldAllowList: ["FirstName", "LastName", "Email"],
      limit: 25,
    });

    expect(result.records[0]?.displayName).toBe(
      "Ada Lovelace ada@example.test",
    );
  });

  it("uses describe permissions for FLS and redacts encrypted fields", async () => {
    const crm = adapter(
      transport(() => ({ status: 200, body: opportunityDescription })),
    );
    const object = await crm.describeObject("Opportunity");
    expect(object).toMatchObject({
      provider: "salesforce",
      kind: "opportunity",
      fields: expect.arrayContaining([
        expect.objectContaining({
          name: "Name",
          readable: true,
          required: true,
        }),
        expect.objectContaining({ name: "Amount", valueType: "currency" }),
        expect.objectContaining({
          name: "Secret__c",
          sensitive: true,
          storagePolicy: "redacted",
          readable: false,
        }),
        expect.objectContaining({
          name: "AccountId",
          referencedObjectType: "Account",
        }),
      ]),
    });
    expect(
      object.fields.find((field) => field.name === "Name")?.updateable,
    ).toBe(true);
    expect(
      object.fields.find((field) => field.name === "Secret__c")?.updateable,
    ).toBe(false);
    const scope = await crm.getAccessScope("Opportunity");
    expect(scope).toMatchObject({
      mode: "user",
      recordVisibility: "actor",
      actorId: "005example",
      fieldPermissionsHash: expect.stringMatching(/^sf-fp-/),
    });
  });

  it("renders updatedAfter as an unquoted SOQL datetime and rejects unsupported association cohorts before I/O", async () => {
    const requests: string[] = [];
    const crm = adapter(
      transport((input) => {
        requests.push(input.path);
        if (input.path === "/sobjects/Opportunity/describe") {
          return { status: 200, body: opportunityDescription };
        }
        return { status: 200, body: { records: [], done: true } };
      }),
    );

    await crm.syncPage({
      scope: {
        objectType: "Opportunity",
        updatedAfter: "2026-07-21T01:02:03-07:00",
      },
      fieldAllowList: ["Name"],
      limit: 25,
    });
    const query = decodeURIComponent(requests[1]!);
    expect(query).toContain("SystemModstamp >= 2026-07-21T08:02:03.000Z");
    expect(query).not.toContain("SystemModstamp >= '2026-07-21");

    const blockedTransport = transport(() => ({
      status: 200,
      body: opportunityDescription,
    }));
    await expect(
      adapter(blockedTransport).syncPage({
        scope: {
          objectType: "Opportunity",
          associatedRecordIds: ["001example"],
        },
        fieldAllowList: ["Name"],
        limit: 25,
      }),
    ).rejects.toThrow("associated-record cohorts are not enabled");
    expect(blockedTransport.request).not.toHaveBeenCalled();
  });

  it("discovers generic custom objects without assuming a native object engine", async () => {
    const mockTransport = transport((input) => {
      if (input.path === "/sobjects/") {
        return {
          status: 200,
          body: {
            sobjects: [{ name: "Renewal__c", queryable: true, custom: true }],
          },
        };
      }
      if (input.path === "/sobjects/Account/describe") {
        return { status: 200, body: { name: "Account", fields: [] } };
      }
      if (input.path === "/sobjects/Contact/describe") {
        return { status: 200, body: { name: "Contact", fields: [] } };
      }
      if (input.path === "/sobjects/Opportunity/describe") {
        return { status: 200, body: opportunityDescription };
      }
      if (input.path === "/sobjects/Renewal__c/describe") {
        return {
          status: 200,
          body: {
            name: "Renewal__c",
            label: "Renewal",
            labelPlural: "Renewals",
            custom: true,
            fields: [],
          },
        };
      }
      throw new Error(`Unexpected request ${input.path}`);
    });
    const objects = await adapter(mockTransport).discoverObjects();
    expect(objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectType: "Renewal__c",
          kind: "custom",
          custom: true,
        }),
      ]),
    );
  });

  it("caps schema discovery before issuing describe requests", async () => {
    const customObjects = Array.from({ length: 150 }, (_, index) => ({
      name: `Custom_${index}__c`,
      queryable: true,
      custom: true,
    }));
    const mockTransport = transport((input) => {
      if (input.path === "/sobjects/") {
        return { status: 200, body: { sobjects: customObjects } };
      }
      return {
        status: 200,
        body: {
          name: input.path.split("/")[2],
          custom: input.path.includes("__c"),
          fields: [],
        },
      };
    });

    const objects = await adapter(mockTransport).discoverObjects();

    expect(objects).toHaveLength(100);
    expect(mockTransport.request).toHaveBeenCalledTimes(101);
  });

  it("reads only bounded, FLS-visible reference relationships", async () => {
    const mockTransport = transport((input) => {
      if (input.path === "/sobjects/Opportunity/describe") {
        return { status: 200, body: opportunityDescription };
      }
      expect(input.path).toContain("/sobjects/Opportunity/006example?fields=");
      return {
        status: 200,
        body: { Id: "006example", AccountId: "001example" },
      };
    });
    const result = await adapter(mockTransport).listRelationships({
      record: {
        connectionId: "salesforce-connection",
        provider: "salesforce",
        objectType: "Opportunity",
        kind: "opportunity",
        remoteId: "006example",
      },
      targetObjectTypes: ["Account"],
      limit: 1,
    });
    expect(result).toEqual({
      complete: true,
      relationships: [
        expect.objectContaining({
          relationshipType: "AccountId",
          to: expect.objectContaining({
            objectType: "Account",
            remoteId: "001example",
          }),
        }),
      ],
    });
  });

  it("fails closed before provider writes when Salesforce cannot guarantee an atomic revision", async () => {
    const calls: string[] = [];
    const mockTransport = transport((input) => {
      calls.push(input.method ?? "GET");
      if (input.path === "/sobjects/Opportunity/describe") {
        return { status: 200, body: opportunityDescription };
      }
      return {
        status: 200,
        body: { Id: "006example", SystemModstamp: "revision-2" },
      };
    });
    const crm = adapter(mockTransport);
    const record = {
      connectionId: "salesforce-connection",
      provider: "salesforce" as const,
      objectType: "Opportunity",
      kind: "opportunity" as const,
      remoteId: "006example",
    };

    await expect(
      crm.applyMutation({
        operation: "update",
        record,
        fields: { Name: "Changed" },
        expectedRemoteRevision: "revision-1",
        idempotencyKey: "mutation-1",
      }),
    ).resolves.toMatchObject({
      status: "conflict",
      remoteRevision: "revision-2",
    });
    await expect(
      crm.applyMutation({
        operation: "update",
        record,
        fields: { Name: "Changed" },
        expectedRemoteRevision: "revision-2",
        idempotencyKey: "mutation-2",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      message: expect.stringContaining("atomic conditional update"),
    });
    expect(calls).toEqual(["GET", "GET", "GET"]);
  });

  it("never exposes response bodies in Salesforce adapter errors", async () => {
    const crm = adapter(
      transport(() => ({
        status: 400,
        body: [{ message: "customer data", errorCode: "INVALID_FIELD" }],
      })),
    );
    await expect(
      crm.syncPage({
        scope: { objectType: "Opportunity" },
        fieldAllowList: ["Name"],
        limit: 1,
      }),
    ).rejects.toThrow("Salesforce API error 400: Salesforce request failed.");
    await expect(
      crm.syncPage({
        scope: { objectType: "Opportunity" },
        fieldAllowList: ["Name"],
        limit: 1,
      }),
    ).rejects.not.toThrow("customer data");
  });

  it("uses provider continuation paths without double-prefixing the Salesforce data API", async () => {
    const workspaceConnection = connection();
    workspace.resolveConnection.mockResolvedValue({
      available: true,
      connection: workspaceConnection,
      appAccess: workspaceConnection.appAccess,
      reason: "Granted to CRM",
    });
    providerApi.resolveOAuth.mockResolvedValue({
      accessToken: "example-oauth-token",
      connectionId: "salesforce-connection",
      accountId: "00Dexample",
      accountLabel: "Example org",
      connectionLabel: "Builder Sales Cloud",
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith("/sobjects/Opportunity/describe")
        ? opportunityDescription
        : url.includes("/query/01gexample-2000")
          ? { records: [], done: true }
          : {
              records: [],
              done: false,
              nextRecordsUrl: "/services/data/v60.0/query/01gexample-2000",
            };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const crm = await createSalesforceCrmAdapter({
        connectionId: "salesforce-connection",
      });
      const first = await crm.syncPage({
        scope: { objectType: "Opportunity" },
        fieldAllowList: ["Name"],
        limit: 25,
      });
      expect(first.nextCursor).toBeTruthy();
      await crm.syncPage({
        scope: { objectType: "Opportunity" },
        fieldAllowList: ["Name"],
        cursor: first.nextCursor,
        limit: 25,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain(
      "https://builder.my.salesforce.com/services/data/v60.0/query/01gexample-2000",
    );
    expect(urls.every((url) => !url.includes("v60.0/services/data"))).toBe(
      true,
    );
  });

  it("resolves only an app-granted workspace credential and validates instance metadata", async () => {
    const workspaceConnection = connection();
    workspace.resolveConnection.mockResolvedValue({
      available: true,
      connection: workspaceConnection,
      appAccess: workspaceConnection.appAccess,
      reason: "Granted to CRM",
    });
    const mockTransport = transport(() => ({ status: 200, body: {} }));
    const result = await createSalesforceCrmAdapter({
      connectionId: "salesforce-connection",
      transport: mockTransport,
    });
    expect(result.connection).toMatchObject({
      connectionId: "salesforce-connection",
      provider: "salesforce",
    });
    expect(workspace.resolveConnection).toHaveBeenCalledWith({
      appId: "crm",
      provider: "salesforce",
      connectionId: "salesforce-connection",
      requireConnected: true,
    });

    providerApi.resolveOAuth.mockResolvedValueOnce({
      accessToken: "example-oauth-token",
      connectionId: "salesforce-connection",
      accountId: "00Dexample",
      accountLabel: "Example org",
      connectionLabel: "Builder Sales Cloud",
    });
    const oauthAdapter = await createSalesforceCrmAdapter({
      connectionId: "salesforce-connection",
    });
    expect(oauthAdapter.connection.provider).toBe("salesforce");
    expect(providerApi.resolveOAuth).toHaveBeenCalledWith(
      { provider: "salesforce", connectionId: "salesforce-connection" },
      { appId: "crm", providerIds: ["salesforce"] },
    );

    providerApi.resolveOAuth.mockRejectedValueOnce(
      new Error("No OAuth account is available"),
    );
    workspace.resolveCredential.mockResolvedValueOnce({
      available: true,
      value: "example-manual-token",
      provenance: { connectionId: "salesforce-connection" },
    });
    const manualAdapter = await createSalesforceCrmAdapter({
      connectionId: "salesforce-connection",
    });
    expect(manualAdapter.connection.provider).toBe("salesforce");
    expect(workspace.resolveCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "crm",
        provider: "salesforce",
        key: "SALESFORCE_ACCESS_TOKEN",
        connectionId: "salesforce-connection",
      }),
    );

    workspace.resolveConnection.mockResolvedValueOnce({
      available: true,
      connection: connection({
        config: { salesforceInstanceUrl: "http://localhost:3000" },
      }),
      appAccess: workspaceConnection.appAccess,
      reason: "Granted to CRM",
    });
    await expect(createSalesforceCrmAdapter()).rejects.toThrow(
      "must use an HTTPS Salesforce instance origin",
    );

    for (const salesforceInstanceUrl of [
      "https://api.example.test",
      "https://builder.my.salesforce.com:8443",
    ]) {
      workspace.resolveConnection.mockResolvedValueOnce({
        available: true,
        connection: connection({ config: { salesforceInstanceUrl } }),
        appAccess: workspaceConnection.appAccess,
        reason: "Granted to CRM",
      });
      await expect(createSalesforceCrmAdapter()).rejects.toThrow(
        "must use an HTTPS Salesforce instance origin",
      );
    }
  });
});
