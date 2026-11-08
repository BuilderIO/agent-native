import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

// Real PGlite behind getDbExec, so the per-user and per-app connection
// filters run their genuine SQL.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b/i.test(input.sql)) {
        const rows = await pglite.prepare(input.sql).all(...args);
        return { rows, rowsAffected: 0 };
      }
      const { changes } = await pglite.prepare(input.sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
  }),
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

const { default: action } =
  await import("./list-workspace-connection-scopes.js");
const { upsertWorkspaceConnection } = await import("../store.js");
const { runWithRequestContext } =
  await import("../../server/request-context.js");

const ORG = "org-scopes";

function asUser<T>(userEmail: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail, orgId: ORG }, fn);
}

function listAs(userEmail: string, appId: string | undefined) {
  return asUser(userEmail, () =>
    action.run(
      { provider: "hubspot" },
      {
        actionName: "list-workspace-connection-scopes",
        caller: "tool",
        userEmail,
        orgId: ORG,
        ...(appId ? { appId } : {}),
      },
    ),
  );
}

beforeAll(async () => {
  process.env.SECRETS_ENCRYPTION_KEY ??= "workspace-connection-scopes-test-key";
  pglite = await createTestPglite();
  await asUser("alice@example.com", async () => {
    await upsertWorkspaceConnection({
      id: "hubspot-alice",
      provider: "hubspot",
      label: "HubSpot: alice",
      accountLabel: "example.hubspot.com",
      status: "connected",
      scopes: ["oauth", "crm.objects.deals.write"],
      config: { credentialMode: "oauth", workspaceConnectionScope: "user" },
      allowedApps: ["crm"],
      allowedUsers: ["alice@example.com"],
    });
    await upsertWorkspaceConnection({
      id: "hubspot-other-app",
      provider: "hubspot",
      label: "HubSpot: other app",
      status: "connected",
      scopes: ["oauth"],
      config: { credentialMode: "oauth", workspaceConnectionScope: "user" },
      allowedApps: ["brain"],
      allowedUsers: ["alice@example.com"],
    });
  });
  await asUser("bob@example.com", () =>
    upsertWorkspaceConnection({
      id: "hubspot-bob",
      provider: "hubspot",
      label: "HubSpot: bob",
      status: "connected",
      scopes: ["oauth", "crm.objects.contacts.read"],
      config: { credentialMode: "oauth", workspaceConnectionScope: "user" },
      allowedApps: ["crm"],
      allowedUsers: ["bob@example.com"],
    }),
  );
}, 30_000);

afterAll(async () => {
  await pglite?.close();
});

describe("list-workspace-connection-scopes", () => {
  it("returns the caller's own connection scopes for this app", async () => {
    const result = await listAs("alice@example.com", "crm");

    expect(result.connections).toEqual([
      {
        id: "hubspot-alice",
        provider: "hubspot",
        label: "HubSpot: alice",
        accountLabel: "example.hubspot.com",
        status: "connected",
        connectionScope: "user",
        ownedByCaller: true,
        grantedScopes: ["oauth", "crm.objects.deals.write"],
      },
    ]);
    expect(result.hint).toMatch(/ask the provider admin/i);
  });

  it("hides other users' personal connections and their details", async () => {
    const result = await listAs("bob@example.com", "crm");

    expect(result.connections.map((connection) => connection.id)).toEqual([
      "hubspot-bob",
    ]);
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
  });

  it("returns nothing for an app the connection is not granted to", async () => {
    const result = await listAs("bob@example.com", "brain");

    expect(result.connections).toEqual([]);
  });

  it("fails loudly without the calling app", async () => {
    await expect(listAs("alice@example.com", undefined)).rejects.toMatchObject({
      errorCode: "app_required",
    });
  });
});
