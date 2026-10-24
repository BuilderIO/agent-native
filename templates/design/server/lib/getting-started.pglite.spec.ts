import { createRequire } from "node:module";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { PRODUCTION_DESIGN_SYSTEM_TEMPLATES } from "../../shared/design-system-templates.js";
import * as schema from "../db/schema.js";

const require = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = require("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  pglite: undefined as any,
  db: undefined as any,
}));

vi.mock("../db/index.js", () => ({ getDb: () => mocks.db, schema }));

const flagEnabled = vi.hoisted(() => ({ value: false }));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: async () => flagEnabled.value,
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
      let index = 0;
      const result = await mocks.pglite.query(
        sql.replace(/\?/g, () => `$${++index}`),
        args,
      );
      return { rows: result.rows };
    },
  }),
}));

import {
  GETTING_STARTED_STEPS,
  canAddBrand,
  hasConnectedDataSource,
  hasInvitedTeammate,
  hasOwnBrand,
  hasOwnDesign,
  hasSavedTemplate,
  hasSharedDesign,
} from "./getting-started.js";

const ME = "me@example.com";
const SHARES = `
  id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
  notified_at TEXT`;
const OWNABLE = `owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'`;

const ctx = (orgId: string | null = null) => ({
  sessionId: ME,
  userEmail: ME,
  orgId,
});
const as = <T>(work: () => Promise<T>, orgId?: string) =>
  runWithRequestContext({ userEmail: ME, orgId }, work);

describe("Getting started completion", () => {
  beforeAll(async () => {
    mocks.pglite = await PGlite.create("memory://");
    mocks.db = drizzle(mocks.pglite, { schema });
    await mocks.pglite.exec(`
      CREATE TABLE designs (id TEXT PRIMARY KEY, ${OWNABLE});
      CREATE TABLE design_shares (${SHARES});
      CREATE TABLE design_systems (id TEXT PRIMARY KEY, data TEXT NOT NULL, ${OWNABLE});
      CREATE TABLE design_system_shares (${SHARES});
      CREATE TABLE design_templates (id TEXT PRIMARY KEY, ${OWNABLE});
      CREATE TABLE design_template_shares (${SHARES});
      CREATE TABLE design_localhost_connections (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        federation_removal_pending_at BIGINT);
      CREATE TABLE org_invitations (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, status TEXT NOT NULL);
    `);
  });

  afterAll(async () => {
    await mocks.pglite.close();
  });

  beforeEach(async () => {
    await mocks.pglite.exec(`
      TRUNCATE designs, design_shares, design_systems, design_system_shares,
        design_templates, design_template_shares, design_localhost_connections,
        org_members, org_invitations;
    `);
  });

  const insert = (sql: string, ...args: unknown[]) =>
    mocks.pglite.query(sql, args);

  it("lists the six steps in order", () => {
    expect(GETTING_STARTED_STEPS.map((step) => step.id)).toEqual([
      "create-design",
      "add-brand",
      "use-real-data",
      "share-feedback",
      "invite-teammate",
      "save-template",
    ]);
  });

  it("counts only designs the user owns", async () => {
    expect(await as(() => hasOwnDesign(ctx()))).toBe(false);
    await insert(
      `INSERT INTO designs (id, owner_email, visibility) VALUES ('d1', 'other@example.com', 'public')`,
    );
    expect(await as(() => hasOwnDesign(ctx()))).toBe(false);
    await insert(
      `INSERT INTO designs (id, owner_email) VALUES ('d2', 'ME@example.com')`,
    );
    expect(await as(() => hasOwnDesign(ctx()))).toBe(true);
  });

  it("is false without a signed-in user instead of guessing", async () => {
    await insert(`INSERT INTO designs (id, owner_email) VALUES ('d1', $1)`, ME);
    expect(await hasOwnDesign({ sessionId: "local" })).toBe(false);
  });

  it("does not count an untouched template copy as the user's brand", async () => {
    const template = PRODUCTION_DESIGN_SYSTEM_TEMPLATES[0]!;
    await insert(
      `INSERT INTO design_systems (id, data, owner_email) VALUES ('s1', $1, $2)`,
      JSON.stringify(template.data),
      ME,
    );
    expect(await as(() => hasOwnBrand(ctx()))).toBe(false);
    await insert(
      `INSERT INTO design_systems (id, data, owner_email) VALUES ('s2', $1, $2)`,
      JSON.stringify({ ...template.data, colors: { primary: "#123456" } }),
      ME,
    );
    expect(await as(() => hasOwnBrand(ctx()))).toBe(true);
  });

  it("offers the brand step only when a design system can be created or already exists", async () => {
    flagEnabled.value = false;
    expect(await as(() => canAddBrand(ctx()))).toBe(false);
    await insert(
      `INSERT INTO design_systems (id, data, owner_email) VALUES ('s1', '{"colors":{}}', $1)`,
      ME,
    );
    expect(await as(() => canAddBrand(ctx()))).toBe(true);
    await mocks.pglite.exec(`TRUNCATE design_systems`);
    flagEnabled.value = true;
    expect(await as(() => canAddBrand(ctx()))).toBe(true);
    flagEnabled.value = false;
  });

  it("counts a connected or manual localhost source but not an errored one", async () => {
    await insert(
      `INSERT INTO design_localhost_connections VALUES ('c1', $1, 'error')`,
      ME,
    );
    await insert(
      `INSERT INTO design_localhost_connections VALUES ('c2', 'other@example.com', 'connected')`,
    );
    expect(await as(() => hasConnectedDataSource(ctx()))).toBe(false);
    await insert(
      `INSERT INTO design_localhost_connections VALUES ('c3', $1, 'connected')`,
      ME,
    );
    expect(await as(() => hasConnectedDataSource(ctx()))).toBe(true);
  });

  it("does not treat default org visibility or a self grant as sharing", async () => {
    await insert(
      `INSERT INTO designs (id, owner_email, org_id, visibility) VALUES ('d1', $1, 'org-1', 'org')`,
      ME,
    );
    await insert(
      `INSERT INTO design_shares (id, resource_id, principal_type, principal_id, created_by) VALUES ('g1', 'd1', 'user', $1, $1)`,
      ME,
    );
    expect(await as(() => hasSharedDesign(ctx("org-1")), "org-1")).toBe(false);

    await insert(
      `INSERT INTO design_shares (id, resource_id, principal_type, principal_id, created_by) VALUES ('g2', 'd1', 'user', 'friend@example.com', $1)`,
      ME,
    );
    expect(await as(() => hasSharedDesign(ctx("org-1")), "org-1")).toBe(true);
  });

  it("counts a public link as sharing", async () => {
    await insert(
      `INSERT INTO designs (id, owner_email, visibility) VALUES ('d1', $1, 'public')`,
      ME,
    );
    expect(await as(() => hasSharedDesign(ctx()))).toBe(true);
  });

  it("is false for someone else's grant on a design the user does not own", async () => {
    await insert(
      `INSERT INTO designs (id, owner_email) VALUES ('d1', 'other@example.com')`,
    );
    await insert(
      `INSERT INTO design_shares (id, resource_id, principal_type, principal_id) VALUES ('g1', 'd1', 'user', $1)`,
      ME,
    );
    expect(await as(() => hasSharedDesign(ctx()))).toBe(false);
  });

  it("needs another member or a pending invitation in the organization", async () => {
    expect(await hasInvitedTeammate(ctx(null))).toBe(false);
    await insert(
      `INSERT INTO org_members (id, org_id, email) VALUES ('m1', 'org-1', $1)`,
      ME,
    );
    expect(await hasInvitedTeammate(ctx("org-1"))).toBe(false);
    await insert(
      `INSERT INTO org_invitations (id, org_id, status) VALUES ('i1', 'org-1', 'accepted')`,
    );
    expect(await hasInvitedTeammate(ctx("org-1"))).toBe(false);
    await insert(
      `INSERT INTO org_invitations (id, org_id, status) VALUES ('i2', 'org-1', 'pending')`,
    );
    expect(await hasInvitedTeammate(ctx("org-1"))).toBe(true);
    await mocks.pglite.exec(`TRUNCATE org_invitations`);
    await insert(
      `INSERT INTO org_members (id, org_id, email) VALUES ('m2', 'org-1', 'mate@example.com')`,
    );
    expect(await hasInvitedTeammate(ctx("org-1"))).toBe(true);
    expect(await hasInvitedTeammate(ctx("org-2"))).toBe(false);
  });

  it("rejects when the organization read fails instead of answering no", async () => {
    await mocks.pglite.exec(
      `ALTER TABLE org_members RENAME COLUMN org_id TO org`,
    );
    await expect(hasInvitedTeammate(ctx("org-1"))).rejects.toThrow();
    await mocks.pglite.exec(
      `ALTER TABLE org_members RENAME COLUMN org TO org_id`,
    );
  });

  it("counts only templates the user saved", async () => {
    await insert(
      `INSERT INTO design_templates (id, owner_email, visibility) VALUES ('t1', 'other@example.com', 'public')`,
    );
    expect(await as(() => hasSavedTemplate(ctx()))).toBe(false);
    await insert(
      `INSERT INTO design_templates (id, owner_email) VALUES ('t2', $1)`,
      ME,
    );
    expect(await as(() => hasSavedTemplate(ctx()))).toBe(true);
  });
});
