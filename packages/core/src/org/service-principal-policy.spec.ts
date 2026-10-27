import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: async (_table: string, createSql: string) => {
    await pglite.exec(createSql);
  },
}));

const policy = await import("./service-principal-policy.js");

beforeAll(async () => {
  pglite = await createTestPglite();
});

beforeEach(async () => {
  await policy.ensureTable();
  await pglite.exec("DELETE FROM service_principal_policies");
});

afterAll(async () => {
  await pglite.close();
});

describe("service-principal policy writes", () => {
  it.each(["", '["*"]', '["read-*",42]'])(
    "reads malformed stored grant %j as deny-all",
    async (storedGrant) => {
      await pglite.query(
        `INSERT INTO service_principal_policies
          (org_id, service_name, risk_tier, lifecycle, allowed_actions)
         VALUES (?, ?, 'medium', 'active', ?)`,
        ["org-a", "ci", storedGrant],
      );
      await expect(
        policy.getServicePrincipalPolicy("org-a", "ci"),
      ).resolves.toMatchObject({
        allowedActions: [],
      });
    },
  );

  it("preserves disjoint concurrent policy updates", async () => {
    await policy.upsertServicePrincipalPolicy("org-a", "ci", {
      team: "platform",
      allowedActions: ["read-*"],
    });

    await Promise.all([
      policy.upsertServicePrincipalPolicy("org-a", "ci", {
        team: "security",
      }),
      policy.upsertServicePrincipalPolicy("org-a", "ci", {
        allowedActions: ["list-*"],
      }),
    ]);

    await expect(
      policy.getServicePrincipalPolicy("org-a", "ci"),
    ).resolves.toMatchObject({
      team: "security",
      allowedActions: ["list-*"],
    });
  });

  it("does not allow a retired principal to transition back to active", async () => {
    await policy.setServicePrincipalLifecycle("org-a", "ci", "retired", {
      actorEmail: "admin@example.test",
      reason: "decommissioned",
    });

    await expect(
      policy.setServicePrincipalLifecycle("org-a", "ci", "active", {
        actorEmail: "admin@example.test",
        reason: "resume",
      }),
    ).rejects.toBeInstanceOf(policy.ServicePrincipalRetiredError);

    await expect(
      policy.getServicePrincipalPolicy("org-a", "ci"),
    ).resolves.toMatchObject({
      lifecycle: "retired",
      lifecycleReason: "decommissioned",
    });
  });
});
