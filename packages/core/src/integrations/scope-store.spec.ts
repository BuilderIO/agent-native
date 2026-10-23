import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { getDbExec } from "../db/client.js";
import { __resetStoreLedgerSnapshotForTests } from "../db/store-registry.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const db = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const args = input.args ?? [];
    const result = await pglite.query(input.sql, args);
    return {
      rows: Array.from(result.rows ?? []),
      rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
    };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  isProductionServerlessFunctionRuntime: () => false,
}));

const {
  _resetIntegrationScopeStoreForTests,
  conversationScopesStore,
  deleteIntegrationScope,
  evaluateIntegrationScopePolicy,
  getIntegrationScope,
  getIntegrationScopeById,
  listIntegrationScopes,
  saveIntegrationScope,
} = await import("./scope-store.js");

const key = {
  platform: "slack",
  tenantId: "team-example",
  conversationId: "channel-example",
};

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetStoreLedgerSnapshotForTests();
  db.execute.mockClear();
  _resetIntegrationScopeStoreForTests();
});

afterEach(async () => {
  await pglite.close();
});

describe("integration scope authorization", () => {
  it("types nullable org guards for Postgres parameter inference", async () => {
    await listIntegrationScopes({
      ownerEmail: "personal@example.com",
      orgId: null,
    });

    expect(db.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("CAST(? AS TEXT) IS NOT NULL"),
      }),
    );
  });

  it("does not reveal, update, or delete another org's scope", async () => {
    const orgA = { ownerEmail: "owner-a@example.com", orgId: "org-a" };
    const orgB = { ownerEmail: "owner-b@example.com", orgId: "org-b" };

    const created = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
        trust: "trusted",
        installationId: "install-example",
      },
      orgA,
    );
    expect(created.orgId).toBe("org-a");

    await expect(getIntegrationScope(key, orgB)).resolves.toBeNull();
    await expect(listIntegrationScopes(orgB)).resolves.toEqual([]);
    await expect(deleteIntegrationScope(key, orgB)).resolves.toBe(false);
    await expect(
      saveIntegrationScope(
        { ...key, conversationType: "channel", trust: "trusted" },
        orgB,
      ),
    ).rejects.toThrow("not available");

    const unchanged = await getIntegrationScope(key, orgA);
    expect(unchanged).toMatchObject({
      orgId: "org-a",
      ownerEmail: "owner-a@example.com",
      installationId: "install-example",
    });
  });

  it("keeps personal scopes owner-only even when another caller has an org", async () => {
    const owner = { ownerEmail: "personal@example.com", orgId: null };
    await saveIntegrationScope(
      { ...key, conversationType: "channel", trust: "trusted", orgId: null },
      owner,
    );

    await expect(
      getIntegrationScope(key, {
        ownerEmail: "different@example.com",
        orgId: "org-example",
      }),
    ).resolves.toBeNull();
    await expect(
      saveIntegrationScope(
        {
          ...key,
          conversationType: "channel",
          trust: "trusted",
          orgId: "other-org",
        },
        { ownerEmail: "personal@example.com", orgId: "org-example" },
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("derives org service principals instead of accepting caller identities", async () => {
    const access = { ownerEmail: "owner@example.com", orgId: "org-example" };
    const first = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
        serviceOwnerEmail: "victim@example.com",
      } as Parameters<typeof saveIntegrationScope>[0],
      access,
    );
    const second = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
      },
      access,
    );

    expect(first.serviceOwnerEmail).toMatch(
      /^integration\+[a-f0-9]{24}@service\.agent-native\.local$/,
    );
    expect(first.serviceOwnerEmail).not.toBe("victim@example.com");
    expect(second.serviceOwnerEmail).toBe(first.serviceOwnerEmail);
  });

  it("keeps personal scopes bound to their verified owner", async () => {
    const scope = await saveIntegrationScope(
      {
        ...key,
        conversationType: "direct_message",
        orgId: null,
      },
      { ownerEmail: "personal@example.com", orgId: null },
    );

    expect(scope.serviceOwnerEmail).toBe("personal@example.com");
  });
});

describe("integration scope agent grants", () => {
  const access = { ownerEmail: "owner@example.com", orgId: "org-example" };

  it("adds empty grants to pre-existing scopes during migration", async () => {
    await conversationScopesStore.migrations[0].run!(getDbExec());
    await pglite.query(
      `INSERT INTO integration_conversation_scopes (
      id, platform, tenant_id, conversation_id, conversation_type,
      owner_email, org_id, service_owner_email, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'channel', $5, $6, $5, 1, 1)`,
      [
        "legacy-scope",
        key.platform,
        key.tenantId,
        key.conversationId,
        access.ownerEmail,
        access.orgId,
      ],
    );

    expect((await getIntegrationScope(key, access))?.allowedAgentIds).toEqual(
      [],
    );
  });

  it("reads current grants by ID only within the authorized org or personal owner", async () => {
    const scope = await saveIntegrationScope(
      { ...key, conversationType: "channel", allowedAgentIds: ["analytics"] },
      access,
    );
    expect(
      (await getIntegrationScopeById(scope.id, access))?.allowedAgentIds,
    ).toEqual(["analytics"]);
    expect(
      await getIntegrationScopeById(scope.id, {
        ownerEmail: "other@example.com",
        orgId: "other-org",
      }),
    ).toBeNull();
    await saveIntegrationScope(
      { ...key, conversationType: "channel", allowedAgentIds: [] },
      access,
    );
    expect(
      (await getIntegrationScopeById(scope.id, access))?.allowedAgentIds,
    ).toEqual([]);
    expect(await getIntegrationScopeById("missing", access)).toBeNull();

    const personal = await saveIntegrationScope(
      {
        ...key,
        conversationId: "personal-dm",
        conversationType: "direct_message",
        orgId: null,
      },
      access,
    );
    expect(
      await getIntegrationScopeById(personal.id, {
        ownerEmail: "other@example.com",
        orgId: access.orgId,
      }),
    ).toBeNull();
    expect((await getIntegrationScopeById(personal.id, access))?.id).toBe(
      personal.id,
    );
  });

  it("denies delegation by default and preserves grants through policy edits", async () => {
    const input = { ...key, conversationType: "channel" as const };
    expect((await saveIntegrationScope(input, access)).allowedAgentIds).toEqual(
      [],
    );

    await saveIntegrationScope(
      { ...input, allowedAgentIds: ["analytics", "agents/research.md"] },
      access,
    );
    const edited = await saveIntegrationScope(
      { ...input, policy: { requireMention: false } },
      access,
    );
    expect(edited.allowedAgentIds).toEqual(["analytics", "agents/research.md"]);
    expect(edited.policy.requireMention).toBe(false);
    expect((await getIntegrationScope(key, access))?.allowedAgentIds).toEqual([
      "analytics",
      "agents/research.md",
    ]);

    await saveIntegrationScope({ ...input, allowedAgentIds: [] }, access);
    expect((await getIntegrationScope(key, access))?.allowedAgentIds).toEqual(
      [],
    );
  });

  it("isolates grants by tenant and organization", async () => {
    await saveIntegrationScope(
      { ...key, conversationType: "channel", allowedAgentIds: ["analytics"] },
      access,
    );
    const otherTenant = { ...key, tenantId: "other-team" };
    expect(
      (
        await saveIntegrationScope(
          { ...otherTenant, conversationType: "channel" },
          access,
        )
      ).allowedAgentIds,
    ).toEqual([]);
    const outsider = { ownerEmail: "other@example.com", orgId: "other-org" };
    await expect(
      saveIntegrationScope(
        { ...key, conversationType: "channel", allowedAgentIds: ["mail"] },
        outsider,
      ),
    ).rejects.toThrow("not available");
    expect((await getIntegrationScope(key, access))?.allowedAgentIds).toEqual([
      "analytics",
    ]);
    expect(await listIntegrationScopes(outsider)).toEqual([]);
  });

  it.each(
    [null, "analytics", [123], [null], [""], [" analytics"], ["   "]].map(
      (allowedAgentIds) => ({ allowedAgentIds }),
    ),
  )(
    "rejects invalid grants without changing persisted grants: $allowedAgentIds",
    async ({ allowedAgentIds }) => {
      await saveIntegrationScope(
        { ...key, conversationType: "channel", allowedAgentIds: ["analytics"] },
        access,
      );
      await expect(
        saveIntegrationScope(
          {
            ...key,
            conversationType: "channel",
            allowedAgentIds,
          } as Parameters<typeof saveIntegrationScope>[0],
          access,
        ),
      ).rejects.toThrow("allowedAgentIds");
      expect((await getIntegrationScope(key, access))?.allowedAgentIds).toEqual(
        ["analytics"],
      );
    },
  );

  it.each(["{", "null", "{}", '["analytics", 1]', '[" "]'])(
    "fails loudly on invalid stored grant JSON: %s",
    async (stored) => {
      await saveIntegrationScope(
        { ...key, conversationType: "channel" },
        access,
      );
      await pglite.query(
        "UPDATE integration_conversation_scopes SET allowed_agent_ids_json = $1",
        [stored],
      );
      await expect(getIntegrationScope(key, access)).rejects.toThrow(
        "allowedAgentIds",
      );
      await expect(listIntegrationScopes(access)).rejects.toThrow(
        "allowedAgentIds",
      );
    },
  );
});

describe("integration scope policy", () => {
  it("defaults to mention-required and fails closed for DMs and untrusted conversations", async () => {
    const access = { ownerEmail: "owner@example.com", orgId: "org-example" };
    const scope = await saveIntegrationScope(
      { ...key, conversationType: "channel" },
      access,
    );

    expect(scope.policy).toEqual({
      requireMention: true,
      allowDirectMessages: false,
      allowGuests: false,
      allowExternalShared: false,
      allowUnknownTrust: false,
    });
    expect(evaluateIntegrationScopePolicy(scope, { mentioned: false })).toEqual(
      { allowed: false, reason: "mention_required" },
    );
    expect(evaluateIntegrationScopePolicy(scope, { mentioned: true })).toEqual({
      allowed: false,
      reason: "unverified_conversation_disabled",
    });

    const dm = await saveIntegrationScope(
      {
        ...key,
        conversationType: "direct_message",
        trust: "trusted",
      },
      access,
    );
    expect(evaluateIntegrationScopePolicy(dm, { mentioned: true })).toEqual({
      allowed: false,
      reason: "direct_messages_disabled",
    });
  });

  it("only opens explicitly enabled policy paths", async () => {
    const scope = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
        trust: "external_shared",
        policy: { allowExternalShared: true },
      },
      { ownerEmail: "owner@example.com", orgId: "org-example" },
    );
    expect(evaluateIntegrationScopePolicy(scope, { mentioned: true })).toEqual({
      allowed: true,
    });
  });
});
