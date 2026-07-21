import { describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({
  resolveConnection: vi.fn(),
  resolveCredential: vi.fn(),
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: workspace.resolveConnection,
  resolveWorkspaceConnectionCredentialForApp: workspace.resolveCredential,
}));

import {
  createHubSpotCrmAdapter,
  HubSpotCrmAdapter,
  type HubSpotTransport,
} from "./hubspot-adapter.js";

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "hubspot-connection",
    provider: "hubspot",
    label: "Sales Hub",
    accountId: "portal-42",
    accountLabel: "Example portal",
    status: "connected",
    scopes: ["crm.objects.deals.read", "crm.objects.deals.write"],
    config: {},
    allowedApps: ["crm"],
    credentialRefs: [{ key: "HUBSPOT_ACCESS_TOKEN", scope: "workspace" }],
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
      connectionId: "hubspot-connection",
      provider: "hubspot",
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
  handler: (
    input: any,
  ) =>
    | { status: number; body?: unknown }
    | Promise<{ status: number; body?: unknown }>,
) {
  return { request: vi.fn(handler) } satisfies HubSpotTransport;
}

function adapter(
  mockTransport: HubSpotTransport,
  options: Record<string, unknown> = {},
) {
  return new HubSpotCrmAdapter({
    connection: connection(options),
    transport: mockTransport,
  });
}

describe("HubSpotCrmAdapter", () => {
  it("projects only the requested fields and preserves opaque ids, cursors, and tombstones", async () => {
    const mockTransport = transport((input) => {
      expect(input.path).toContain("/crm/v3/objects/deals?");
      expect(input.path).toContain("properties=dealname%2Camount");
      expect(input.path).toContain("archived=true");
      expect(input.path).toContain("after=opaque-before");
      return {
        status: 200,
        body: {
          results: [
            {
              id: "00042",
              updatedAt: "2026-07-21T01:02:03.000Z",
              archived: true,
              properties: {
                dealname: "Renewal",
                amount: "1000",
                secret_note: "must not escape",
              },
            },
          ],
          paging: { next: { after: "opaque-after" } },
        },
      };
    });
    const result = await adapter(mockTransport).syncPage({
      scope: { objectType: "deals", includeDeleted: true },
      fieldAllowList: ["dealname", "amount"],
      cursor: "opaque-before",
      limit: 25,
    });

    expect(result).toMatchObject({
      nextCursor: "opaque-after",
      complete: false,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      ref: { remoteId: "00042", objectType: "deals" },
      fields: { dealname: "Renewal", amount: "1000" },
      deleted: true,
      accessScope: { key: "hubspot-connection:grant-42", grantId: "grant-42" },
    });
    expect(result.records[0]!.fields).not.toHaveProperty("secret_note");
  });

  it("discovers generic custom object types without normalizing their opaque ids", async () => {
    const mockTransport = transport((input) => {
      if (input.path === "/crm/v3/schemas/2-007") {
        return {
          status: 200,
          body: {
            objectTypeId: "2-007",
            name: "2-007",
            labels: { singular: "Renewal", plural: "Renewals" },
            metaType: "PORTAL_SPECIFIC",
          },
        };
      }
      if (input.path === "/crm/v3/properties/2-007") {
        return {
          status: 200,
          body: {
            results: [
              { name: "renewal_score", label: "Renewal score", type: "number" },
            ],
          },
        };
      }
      throw new Error(`Unexpected request ${input.path}`);
    });

    const result = await adapter(mockTransport).describeObject("2-007");

    expect(result).toMatchObject({
      objectType: "2-007",
      kind: "custom",
      custom: true,
      fields: [
        {
          name: "renewal_score",
          storagePolicy: "remote-only",
          valueType: "number",
        },
      ],
    });
  });

  it("paginates labeled relationship edges without traversing every remote page", async () => {
    const mockTransport = transport((input) => {
      expect(input.path).toContain("/associations/contacts?");
      expect(input.path).toContain("limit=10");
      return {
        status: 200,
        body: {
          results: [
            {
              toObjectId: "contact-0007",
              associationTypes: [
                {
                  associationCategory: "USER_DEFINED",
                  associationTypeId: 91,
                  label: "Champion",
                },
              ],
            },
          ],
          paging: { next: { after: "provider-association-cursor" } },
        },
      };
    });
    const result = await adapter(mockTransport).listRelationships({
      record: {
        connectionId: "hubspot-connection",
        provider: "hubspot",
        objectType: "deals",
        kind: "opportunity",
        remoteId: "deal-0001",
      },
      targetObjectTypes: ["contacts"],
      limit: 10,
    });

    expect(result).toMatchObject({ complete: false });
    expect(result.nextCursor).toBeTruthy();
    expect(result.relationships).toEqual([
      expect.objectContaining({
        relationshipType: "USER_DEFINED:91",
        label: "Champion",
        to: expect.objectContaining({ remoteId: "contact-0007" }),
      }),
    ]);
  });

  it("returns conflicts for stale revisions and rejects destructive writes", async () => {
    const mockTransport = transport((input) => {
      expect(input.method).toBeUndefined();
      return {
        status: 200,
        body: { id: "deal-1", updatedAt: "new-revision", properties: {} },
      };
    });
    const crm = adapter(mockTransport);
    const record = {
      connectionId: "hubspot-connection",
      provider: "hubspot" as const,
      objectType: "deals",
      kind: "opportunity" as const,
      remoteId: "deal-1",
    };

    await expect(
      crm.applyMutation({
        operation: "update",
        record,
        fields: { dealname: "Changed" },
        expectedRemoteRevision: "old-revision",
        idempotencyKey: "mutation-1",
      }),
    ).resolves.toMatchObject({
      status: "conflict",
      remoteRevision: "new-revision",
    });
    await expect(
      crm.applyMutation({
        operation: "delete",
        record,
        idempotencyKey: "mutation-2",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      message: expect.stringContaining("deletion"),
    });
    expect(mockTransport.request).toHaveBeenCalledTimes(1);
  });

  it("fails closed through the app-scoped workspace connection resolver", async () => {
    const workspaceConnection = connection();
    workspace.resolveConnection.mockResolvedValue({
      available: true,
      connection: workspaceConnection,
      appAccess: workspaceConnection.appAccess,
      reason: "Granted to CRM",
    });
    const mockTransport = transport(() => ({ status: 200, body: {} }));

    const result = await createHubSpotCrmAdapter({
      connectionId: "hubspot-connection",
      transport: mockTransport,
    });

    expect(result.connection).toMatchObject({
      connectionId: "hubspot-connection",
      provider: "hubspot",
    });
    expect(workspace.resolveConnection).toHaveBeenCalledWith({
      appId: "crm",
      provider: "hubspot",
      connectionId: "hubspot-connection",
      requireConnected: true,
    });
  });
});
