import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// Real source store + real request-context against an in-memory PGlite, so the
// strict custom-agent resolver exercises the genuine resourceListAccessible /
// resourceGet ACL rather than a mocked store. `../db/client.js` is the only
// module replaced; everything else is the shipped implementation.
vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: FrameworkClient) => Promise<T>): Promise<T>;
}

function frameworkClientFor(client: any): FrameworkClient {
  return {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      let parameter = 0;
      const postgresSql = sql.replace(/\?/g, () => `$${++parameter}`);
      const result = await client.query(postgresSql, args);
      return {
        rows: Array.from(result.rows ?? []),
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: (fn) =>
      client.transaction((tx: any) => fn(frameworkClientFor(tx))),
  };
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = frameworkClientFor(pglite.db);
});

afterAll(async () => {
  await pglite.close();
});

const {
  organizationResourceOwner,
  resourceGet,
  resourceListAccessible,
  resourceMove,
  resourcePut,
} = await import("./store.js");
const { findAccessibleCustomAgent, findAccessibleCustomAgentByResourceId } =
  await import("./agents.js");
const { runWithRequestContext } = await import("../server/request-context.js");

const OWNER = "qa50-owner@example.test";
const FOREIGN = "qa50-foreign@example.test";
const ORG_A = "qa50-org-a";
const ORG_B = "qa50-org-b";

function agentContent(name: string, model: string): string {
  return `---\nname: ${name}\nmodel: ${model}\n---\n${name} instructions`;
}

function as(orgId: string, fn: () => Promise<any>): Promise<any> {
  return runWithRequestContext({ userEmail: OWNER, orgId }, fn);
}

describe("strict custom-agent resource identity against real PGlite ACL", () => {
  it("resolves the caller's own active personal agent by resource id", async () => {
    const created = await resourcePut(
      OWNER,
      "agents/qa50-personal-active.md",
      agentContent("QA50 Personal Active", "personal-model"),
    );

    const profile = await as(ORG_A, () =>
      findAccessibleCustomAgentByResourceId(OWNER, created.id),
    );

    expect(profile).toMatchObject({
      id: "qa50-personal-active",
      path: "agents/qa50-personal-active.md",
      name: "QA50 Personal Active",
      model: "personal-model",
    });
  });

  it("never resolves a foreign personal resource id, even though the row exists", async () => {
    const foreign = await resourcePut(
      FOREIGN,
      "agents/qa50-foreign-personal.md",
      agentContent("QA50 Foreign Personal", "foreign-model"),
    );

    const profile = await as(ORG_A, () =>
      findAccessibleCustomAgentByResourceId(OWNER, foreign.id),
    );
    expect(profile).toBeNull();

    // The row really is there for its owner, and the caller's listing is the
    // ACL gate that keeps it out: resourceGet alone would have returned it.
    const owned = await runWithRequestContext(
      { userEmail: FOREIGN, orgId: ORG_A },
      () => resourceGet(foreign.id),
    );
    expect(owned?.owner).toBe(FOREIGN);

    const listed = await as(ORG_A, () =>
      resourceListAccessible(OWNER, "agents/"),
    );
    expect(listed.some((resource) => resource.id === foreign.id)).toBe(false);
  });

  it("rejects the old id after A is trashed and B takes the same path", async () => {
    const a = await resourcePut(
      OWNER,
      "agents/qa50-replaced.md",
      agentContent("QA50 A", "a-model"),
    );
    await resourceMove(a.id, `trash/agents/${a.id}.md`);
    const b = await resourcePut(
      OWNER,
      "agents/qa50-replaced.md",
      agentContent("QA50 B", "b-model"),
    );
    expect(b.id).not.toBe(a.id);

    const byOldId = await as(ORG_A, () =>
      findAccessibleCustomAgentByResourceId(OWNER, a.id),
    );
    expect(byOldId).toBeNull();

    const byNewId = await as(ORG_A, () =>
      findAccessibleCustomAgentByResourceId(OWNER, b.id),
    );
    expect(byNewId).toMatchObject({ name: "QA50 B", model: "b-model" });

    // The legacy path lookup is what would have silently substituted B for the
    // trashed A; the strict resolver above did not.
    const legacy = await as(ORG_A, () =>
      findAccessibleCustomAgent(OWNER, "qa50-replaced"),
    );
    expect(legacy).toMatchObject({ name: "QA50 B" });
  });

  it("rejects an organization resource recorded in another organization", async () => {
    const orgResource = await resourcePut(
      organizationResourceOwner(ORG_A),
      "agents/qa50-org-resource.md",
      agentContent("QA50 Org Resource", "org-model"),
    );

    const inOwnOrg = await as(ORG_A, () =>
      findAccessibleCustomAgentByResourceId(OWNER, orgResource.id),
    );
    expect(inOwnOrg).toMatchObject({ name: "QA50 Org Resource" });

    const inOtherOrg = await as(ORG_B, () =>
      findAccessibleCustomAgentByResourceId(OWNER, orgResource.id),
    );
    expect(inOtherOrg).toBeNull();
  });
});
