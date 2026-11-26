import type { ActionRunContext } from "@agent-native/core/action";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  editableSources: new Set(["s-1", "s-2", "s-shared"]),
}));

vi.mock("../server/db/index.js", () => ({ getDb: () => state.db, schema }));

vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestOrgId: () => "org-1",
    getRequestUserEmail: () => "owner@example.test",
  }),
);

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: async (_type: string, id: string) => {
    if (!state.editableSources.has(id)) throw new Error(`No access to ${id}`);
    return { role: "editor", resource: { id } };
  },
}));

const pg = new PGlite();

const createTable = (table: Parameters<typeof getTableColumns>[0]) =>
  `CREATE TABLE ${getTableName(table)} (${Object.values(getTableColumns(table))
    .map((column) => `"${column.name}" text`)
    .join(",")})`;

beforeAll(async () => {
  state.db = drizzle(pg, { schema });
  await pg.exec(createTable(schema.brainSources));
  await pg.exec(createTable(schema.brainRawCaptures));
  await pg.exec(createTable(schema.brainKnowledge));
  await pg.exec(`
    INSERT INTO brain_sources (id,title,provider,owner_email,org_id) VALUES
      ('s-1','Notes','manual','owner@example.test','org-1'),
      ('s-2','Slack','slack','owner@example.test','org-1'),
      ('s-shared','Company Context','manual','admin@example.test','org-1'),
      ('s-hidden','Private','manual','teammate@example.test','org-1'),
      ('manual-mine','Manual imports','manual','owner@example.test','org-1'),
      ('manual-meetings','Meeting transcripts','manual','owner@example.test','org-1'),
      ('manual-teammate','Manual imports','manual','teammate@example.test','org-1'),
      ('manual-other-org','Manual imports','manual','owner@example.test','org-2');
    INSERT INTO brain_raw_captures (id,source_id,external_id) VALUES
      ('c-1','s-1','doc-1'),
      ('c-2','s-shared','context-1'),
      ('c-3','s-hidden','doc-1'),
      ('c-4','manual-mine','manual-1'),
      ('c-5','manual-mine','markdown:notes/plan.md'),
      ('c-6','manual-meetings','meet-1'),
      ('c-7','manual-teammate','teammate-1'),
      ('c-8','manual-other-org','other-org-1');
    INSERT INTO brain_knowledge (id,published_resource_path,intelligence_kind) VALUES
      ('k-mirrored','context/company-brain/facts/k-mirrored.md',NULL),
      ('k-plain',NULL,NULL);
  `);
});
afterAll(async () => pg.close());

const SERVED = [
  "ask-brain",
  "enqueue-captures-distillation",
  "enqueue-distillation",
  "get-brain-health",
  "get-capture",
  "get-knowledge",
  "get-settings",
  "get-source",
  "list-captures",
  "list-connection-providers",
  "list-distillation-queue",
  "list-knowledge",
  "list-projects",
  "list-proposals",
  "list-sources",
  "preview-canonical-resource",
  "retry-distillation",
  "search-everything",
  "search-knowledge",
  "sync-due-sources",
  "sync-source",
  "update-proposal",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "approve-proposal",
  "delete-source",
  "reject-proposal",
  "review-proposal",
  "set-knowledge-canonical",
] as const;

const IN_APP_ONLY = [
  "backfill-search-embeddings",
  "claim-distillation",
  "ensure-company-context-source",
  "get-brain-admin-status",
  "get-pilot-report",
  "mark-capture-distilled",
  "remediate-legacy-capture-audiences",
  "resanitize-captures",
  "run-demo-eval",
  "run-retrieval-eval",
  "run-slack-pilot",
  "set-settings",
  "test-slack-connection",
] as const;

const update = (knowledgeId: string) => ({
  knowledgeId,
  expectedRevision: "r-1",
  title: "T",
  body: "B",
});
const supersede = (supersedesId: string) => ({
  supersedesId,
  supersedesRevision: "r-1",
  title: "T",
  body: "B",
});
const capture = (fields: { sourceId?: string; externalId?: string }) => ({
  title: "Notes",
  content: "Hello",
  ...fields,
});
const transcript = (fields: { externalId?: string; sourceTitle?: string }) => ({
  title: "Sync",
  transcript: "Hi",
  ...fields,
});
const markdown = (paths: string[], sourceId?: string) => ({
  sourceId,
  files: paths.map((path) => ({ path, content: "# Plan" })),
});

const ASKS_FIRST = [
  ["create-source", { title: "Team", visibility: "org" }],
  ["create-source", { title: "Webhook", sourceKey: "ingest-1" }],
  ["create-source", { title: "Webhook", config: { sourceKey: "ingest-1" } }],
  [
    "create-source",
    { title: "Webhook", configJson: '{"ingestTokenHash":"abc"}' },
  ],
  ["manage-project", { operation: "delete", projectId: "p-1" }],
  ["update-source", { id: "s-1", status: "archived" }],
  ["update-source", { id: "s-1", status: "error" }],
  ["update-source", { id: "s-1", config: { channels: ["C1"] } }],
  ["update-source", { id: "s-1", configJson: '{"channels":["C1"]}' }],
  ["update-source", { id: "s-1", cursor: {} }],
  ["update-source", { id: "s-1", policy: { trustTier: "blessed" } }],
  ["update-source", { id: "s-1", title: "Renamed", status: "archived" }],
  ["write-knowledge", { title: "T", body: "B", publishCanonical: true }],
  ["write-knowledge", update("k-mirrored")],
  ["write-knowledge", { ...update("k-plain"), publishCanonical: true }],
  ["write-knowledge", supersede("k-mirrored")],
  ["import-capture", capture({ sourceId: "s-1", externalId: "doc-1" })],
  [
    "import-capture",
    capture({ sourceId: "s-shared", externalId: "context-1" }),
  ],
  ["import-capture", capture({ externalId: "manual-1" })],
  ["import-transcript", transcript({ externalId: "meet-1" })],
  ["import-markdown-files", markdown(["notes\\plan.md"])],
  ["import-markdown-files", markdown(["new.md", "notes//plan.md"])],
] as const;

const RUNS_WITHOUT_ASKING = [
  ["create-source", { title: "Notes", visibility: "private" }],
  ["create-source", { title: "Notes" }],
  ["create-source", { title: "Slack", configJson: '{"channels":["C1"]}' }],
  ["manage-project", { operation: "create", title: "Launch" }],
  ["manage-project", { operation: "update", projectId: "p-1", title: "L" }],
  ["manage-project", { operation: "set-default", projectId: "p-1" }],
  ["update-source", { id: "s-1", title: "Renamed" }],
  ["update-source", { id: "s-1", status: "paused" }],
  ["update-source", { id: "s-1", status: "active" }],
  ["write-knowledge", { title: "T", body: "B", publishCanonical: false }],
  ["write-knowledge", { title: "T", body: "B" }],
  ["write-knowledge", update("k-plain")],
  ["write-knowledge", supersede("k-plain")],
  ["import-capture", capture({ sourceId: "s-1", externalId: "new-1" })],
  ["import-capture", capture({ sourceId: "s-2", externalId: "doc-1" })],
  ["import-capture", capture({ sourceId: "s-1" })],
  ["import-capture", capture({ externalId: "teammate-1" })],
  ["import-capture", capture({ externalId: "other-org-1" })],
  [
    "import-capture",
    { ...capture({ externalId: "manual-1" }), sourceTitle: "Research" },
  ],
  [
    "import-transcript",
    transcript({ externalId: "meet-1", sourceTitle: "Manual imports" }),
  ],
  ["import-markdown-files", markdown(["notes/other.md"])],
  ["import-markdown-files", markdown(["notes/plan.md"], "s-1")],
] as const;

const ALIASES = [
  ["get-brain-settings", "get-settings"],
  ["update-brain-settings", "set-settings"],
] as const;

type Exposure = {
  mcpTool?: boolean | "search";
  schema?: { parseAsync(input: unknown): Promise<unknown> };
  needsApproval?:
    | boolean
    | ((args: unknown, ctx?: ActionRunContext) => boolean | Promise<boolean>);
};

async function load(name: string): Promise<Exposure> {
  return ((await import(`./${name}.ts`)) as { default: Exposure }).default;
}

async function preparedApprovalRule(name: string) {
  const action = await load(name);
  expect(action.mcpTool).toBe("search");
  const approves = action.needsApproval;
  if (typeof approves !== "function" || !action.schema) {
    throw new Error(`${name} has no approval rule`);
  }
  const schema = action.schema;
  return async (args: unknown, ctx: ActionRunContext) =>
    approves(await schema.parseAsync(args), ctx);
}

const IN_APP_AGENT = { caller: "tool" } as ActionRunContext;
const APP_UI = { caller: "frontend" } as ActionRunContext;
const OUTSIDE_AGENT = { caller: "mcp" } as ActionRunContext;

describe("Brain actions over MCP", () => {
  it.each(SERVED)(
    "serves %s to outside agents through tool-search",
    async (name) => {
      const action = await load(name);
      expect(action.mcpTool).toBe("search");
      expect(action.needsApproval).toBeUndefined();
    },
  );

  it.each(APPROVED_WHEN_OUTSIDE)(
    "serves %s through tool-search, and asks only outside agents to approve it",
    async (name) => {
      const action = await load(name);
      expect(action.mcpTool).toBe("search");
      const approves = action.needsApproval;
      if (typeof approves !== "function") {
        throw new Error(`${name} has no approval rule`);
      }
      expect(await approves({}, IN_APP_AGENT)).toBe(false);
      expect(await approves({}, APP_UI)).toBe(false);
      expect(await approves({}, OUTSIDE_AGENT)).toBe(true);
    },
  );

  it.each(ASKS_FIRST)(
    "asks an outside agent before %s with %o",
    async (name, args) => {
      const approves = await preparedApprovalRule(name);
      expect(await approves(args, OUTSIDE_AGENT)).toBe(true);
      expect(await approves(args, IN_APP_AGENT)).toBe(false);
      expect(await approves(args, APP_UI)).toBe(false);
    },
  );

  it.each(RUNS_WITHOUT_ASKING)(
    "lets an outside agent call %s with %o without asking",
    async (name, args) => {
      const approves = await preparedApprovalRule(name);
      expect(await approves(args, OUTSIDE_AGENT)).toBe(false);
    },
  );

  it("refuses an outside import into a source the caller can't edit", async () => {
    const approves = await preparedApprovalRule("import-capture");
    const args = capture({ sourceId: "s-hidden", externalId: "doc-1" });
    await expect(approves(args, OUTSIDE_AGENT)).rejects.toThrow(
      "No access to s-hidden",
    );
  });

  it.each(ALIASES)(
    "decides %s once, as the same action as %s",
    async (alias, name) => {
      expect(await load(alias)).toBe(await load(name));
    },
  );

  it.each(IN_APP_ONLY)("keeps %s in the app, off MCP", async (name) => {
    expect((await load(name)).mcpTool).toBe(false);
  });
});
