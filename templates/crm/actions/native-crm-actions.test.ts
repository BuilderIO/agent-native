import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connectionRows: [] as Array<{ id: string }>,
  configured: [] as unknown[],
  adapterOptions: [] as unknown[],
  mutations: [] as unknown[],
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ scoped: true })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => state.connectionRows),
        }),
      }),
    }),
  }),
  schema: {
    crmConnections: { id: "connections.id", provider: "connections.provider" },
    crmConnectionShares: {},
  },
}));

vi.mock("../server/crm/native-adapter.js", () => ({
  configureNativeCrmConnection: vi.fn(async (input) => {
    state.configured.push(input);
    return {
      id: "native-auto",
      label: "Native SQL",
      accessScope: {},
      ...input.ownership,
    };
  }),
  createNativeCrmAdapter: vi.fn(async (options) => {
    state.adapterOptions.push(options);
    return {
      applyMutation: vi.fn(async (mutation) => {
        state.mutations.push(mutation);
        return {
          status: "applied",
          remoteRevision: "1",
          record: {
            ref: { localId: "record-1" },
            // Mirrors summaryColumns()' real derivation: accounts and
            // opportunities carry `name`, people carry `displayName`.
            displayName: mutation.fields.displayName ?? mutation.fields.name,
          },
        };
      }),
    };
  }),
}));

import configureNativeCrm from "./configure-native-crm.js";
import createCrmRecord, {
  nativeRecordFieldsSchema,
} from "./create-crm-record.js";

const context = {
  caller: "frontend" as const,
  userEmail: "owner@example.test",
  orgId: "org-1",
};

describe("Native CRM actions", () => {
  beforeEach(() => {
    state.connectionRows = [];
    state.configured = [];
    state.adapterOptions = [];
    state.mutations = [];
  });

  it("configures a local-authoritative CRM using the request ownership scope", async () => {
    const result = await configureNativeCrm.run({}, context);

    expect(result).toMatchObject({
      id: "native-auto",
      provider: "native",
      mode: "native",
      ownerEmail: context.userEmail,
      orgId: context.orgId,
      visibility: "org",
    });
    expect(state.configured).toEqual([
      {
        label: undefined,
        ownership: {
          ownerEmail: context.userEmail,
          orgId: context.orgId,
          visibility: "org",
        },
      },
    ]);
  });

  it("bootstraps Native SQL and creates an audited local account", async () => {
    const result = await createCrmRecord.run(
      {
        kind: "account",
        displayName: "Acme",
        fields: { domain: "acme.example" },
        idempotencyKey: "create-acme",
      },
      context,
    );

    expect(result).toMatchObject({
      recordId: "record-1",
      connectionId: "native-auto",
      provider: "native",
      displayName: "Acme",
    });
    expect(state.adapterOptions).toEqual([
      { connectionId: "native-auto", initiatedBy: "human" },
    ]);
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0]).toMatchObject({
      operation: "create",
      fields: {
        name: "Acme",
        domain: "acme.example",
      },
    });
    // An account already has a `name` attribute; writing `displayName` too
    // would mint a second attribute and a second history stream for one value.
    expect(state.mutations[0].fields).not.toHaveProperty("displayName");
  });

  it("stores a person's name as displayName, since people have no name attribute", async () => {
    const result = await createCrmRecord.run(
      {
        kind: "person",
        displayName: "Dana Reyes",
        fields: { primaryEmail: "dana@acme.example" },
        idempotencyKey: "create-dana",
      },
      context,
    );

    expect(result).toMatchObject({ displayName: "Dana Reyes" });
    expect(state.mutations[0]).toMatchObject({
      operation: "create",
      fields: {
        displayName: "Dana Reyes",
        primaryEmail: "dana@acme.example",
      },
    });
    expect(state.mutations[0].fields).not.toHaveProperty("name");
  });

  it("rejects unsafe field names and payloads before persistence", () => {
    expect(
      nativeRecordFieldsSchema.safeParse({ transcript: "not permitted" })
        .success,
    ).toBe(false);
    expect(
      nativeRecordFieldsSchema.safeParse({
        note: "data:text/plain;base64,AAAA",
      }).success,
    ).toBe(false);
  });
});
