import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import { table, text, ownableColumns } from "../../db/schema.js";
import type { MintedTokenRow } from "../../mcp/connect-store.js";
import type { ServicePrincipalPolicy } from "../../org/service-principal-policy.js";
import { runWithRequestContext } from "../../server/request-context.js";
import { ForbiddenError } from "../access.js";
import { registerShareableResource } from "../registry.js";
import { createSharesTable } from "../schema.js";
import listResourceShares from "./list-resource-shares.js";
import shareResource from "./share-resource.js";

const state = vi.hoisted(() => ({
  tokens: [] as MintedTokenRow[],
  policies: [] as ServicePrincipalPolicy[],
  tokensError: null as Error | null,
  sendEmail: vi.fn(async () => ({ status: "sent" as const })),
}));

vi.mock("../../db/client.js", () => {
  return {
    getDbExec: () => sharedClient,
    getScopedDbExec: () => undefined,
    isProductionServerlessFunctionRuntime: () => false,
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

vi.mock("../../mcp/connect-store.js", () => ({
  listOrgServiceTokens: async (orgId: string) => {
    if (state.tokensError) throw state.tokensError;
    return state.tokens.filter((token) => token.orgId === orgId);
  },
  serviceIdentityEmail: (name: string, orgId: string) =>
    `svc-${name}@service.${orgId}`,
}));

vi.mock("../../org/service-principal-policy.js", () => ({
  listServicePrincipalPolicies: async (orgId: string) =>
    state.policies.filter((policy) => policy.orgId === orgId),
}));

vi.mock("../../server/email.js", () => ({
  isEmailConfigured: async () => true,
  sendEmail: state.sendEmail,
}));

vi.mock("../../user-profile/store.js", () => ({
  getUserProfiles: async (emails: readonly string[]) =>
    new Map(
      emails
        .filter((email) => email === memberEmail)
        .map((email) => [email, { email, name: "Vee Member" }]),
    ),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

const resourceType = "agent-shared-doc";
const ownerEmail = "owner+qa@example.com";
const memberEmail = "member+qa@example.com";
const orgId = "org-agents";
const otherOrgId = "org-elsewhere";
const reviewerAgent = `svc-reviewer@service.${orgId}`;

const docs = table("agent_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});
const docShares = createSharesTable("agent_doc_shares");

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let db: ReturnType<typeof drizzle>;

function token(
  serviceName: string,
  overrides: Partial<MintedTokenRow> = {},
): MintedTokenRow {
  return {
    id: `tok-${serviceName}`,
    jti: `jti-${serviceName}`,
    ownerEmail: `svc-${serviceName}@service.${orgId}`,
    orgId,
    label: null,
    createdAt: 0,
    lastUsedAt: null,
    revokedAt: null,
    kind: "service",
    serviceName,
    createdBy: ownerEmail,
    ...overrides,
  };
}

function retiredPolicy(serviceName: string): ServicePrincipalPolicy {
  return {
    orgId,
    serviceName,
    ownerEmail,
    team: null,
    riskTier: "low",
    purpose: null,
    lifecycle: "retired",
    allowedActions: null,
    lifecycleReason: null,
    lifecycleChangedBy: ownerEmail,
    lifecycleChangedAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(async () => {
  state.tokens = [
    token("reviewer"),
    token("revoked", { revokedAt: 1 }),
    token("retired"),
    token("outsider", { orgId: otherOrgId }),
  ];
  state.policies = [retiredPolicy("retired")];
  state.tokensError = null;
  state.sendEmail.mockClear();

  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE agent_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE agent_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at BIGINT NOT NULL,
      federation_removal_pending_at INTEGER
    );
    CREATE TABLE org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      role TEXT NOT NULL DEFAULT 'member'
    );
    INSERT INTO org_members (id, org_id, email, role, joined_at)
      VALUES ('m1', '${orgId}', '${ownerEmail}', 'owner', 0),
             ('m2', '${orgId}', '${memberEmail}', 'member', 0);
    INSERT INTO agent_docs (id, title, owner_email, org_id, visibility)
      VALUES ('doc-1', 'Doc', '${ownerEmail}', '${orgId}', 'private');
  `);
  db = drizzle(pglite.db);

  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };

  registerShareableResource({
    type: resourceType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "Agent Doc",
    titleColumn: "title",
    getDb: () => db,
    requireOrgMemberForUserShares: true,
    agentRead: { actions: ["get-agent-doc"], idParam: "docId" },
  });
});

afterEach(async () => {
  await pglite.close();
});

async function shareRows() {
  return (await pglite
    .prepare(
      "SELECT principal_type, principal_id, role, notified_at FROM agent_doc_shares WHERE resource_id = ?",
    )
    .all("doc-1")) as Array<Record<string, unknown>>;
}

function shareWith(principalId: string) {
  return shareResource.run({
    resourceType,
    resourceId: "doc-1",
    principalType: "user",
    principalId,
    role: "editor",
    notify: true,
  });
}

describe("sharing with org agents", () => {
  it("grants an org agent access as a user principal and never emails it", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(shareWith(reviewerAgent)).resolves.toMatchObject({
        updated: false,
      });
    });

    expect(await shareRows()).toEqual([
      {
        principal_type: "user",
        principal_id: reviewerAgent,
        role: "editor",
        notified_at: null,
      },
    ]);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["a revoked token", `svc-revoked@service.${orgId}`],
    ["a retired principal", `svc-retired@service.${orgId}`],
    ["another org's agent", `svc-outsider@service.${otherOrgId}`],
    ["an unknown service name", `svc-typo@service.${orgId}`],
  ])("refuses %s on a resource locked to its org", async (_case, email) => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await expect(shareWith(email)).rejects.toBeInstanceOf(ForbiddenError);
    });
    expect(await shareRows()).toEqual([]);
  });

  it("lists the org's live agents for an owner and labels agent rows", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await shareWith(reviewerAgent);
      await shareResource.run({
        resourceType,
        resourceId: "doc-1",
        principalType: "user",
        principalId: memberEmail,
        role: "viewer",
        notify: false,
      });
      const result = (await listResourceShares.run({
        resourceType,
        resourceId: "doc-1",
      })) as any;

      expect(result.agents).toEqual([
        { email: reviewerAgent, name: "reviewer" },
      ]);
      expect(result.agentsUnavailable).toBeUndefined();
      const byPrincipal = Object.fromEntries(
        result.shares.map((share: any) => [share.principalId, share]),
      );
      expect(byPrincipal[reviewerAgent]).toMatchObject({
        displayName: "reviewer",
        agent: true,
      });
      expect(byPrincipal[memberEmail]).toMatchObject({
        displayName: "Vee Member",
      });
      expect(byPrincipal[memberEmail].agent).toBeUndefined();
    });
  });

  it("names the tool that reads the resource for the agent prompt", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const result = (await listResourceShares.run({
        resourceType,
        resourceId: "doc-1",
      })) as any;
      expect(result.agentRead).toMatchObject({
        actions: ["get-agent-doc"],
        idParam: "docId",
      });
      expect(result.agentRead.label).toMatch(/agent doc$/);
    });
  });

  it("does not list agents for someone who cannot manage access", async () => {
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await shareResource.run({
        resourceType,
        resourceId: "doc-1",
        principalType: "user",
        principalId: memberEmail,
        role: "viewer",
        notify: false,
      });
    });
    await runWithRequestContext({ userEmail: memberEmail, orgId }, async () => {
      const result = (await listResourceShares.run({
        resourceType,
        resourceId: "doc-1",
      })) as any;
      expect(result.role).toBe("viewer");
      expect(result.agents).toBeUndefined();
    });
  });

  it("reports agents as unavailable, not empty, when they cannot be read", async () => {
    state.tokensError = new Error("token store down");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const result = (await listResourceShares.run({
        resourceType,
        resourceId: "doc-1",
      })) as any;
      expect(result.agents).toBeUndefined();
      expect(result.agentsUnavailable).toBe(true);
    });
    consoleError.mockRestore();
  });
});
