import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredRows = {
  knowledge?: {
    publishedResourcePath: string | null;
    intelligenceKind: string | null;
  }[];
  captures?: { id: string }[];
};

const stored = vi.hoisted(() => ({ rows: {} as StoredRows }));

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
  accessFilter: () => undefined,
}));

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  const rowsFor = (table: unknown) =>
    (table === schema.brainKnowledge
      ? stored.rows.knowledge
      : table === schema.brainRawCaptures
        ? stored.rows.captures
        : undefined) ?? [];
  const query = (rows: readonly unknown[]) => ({
    innerJoin: () => query(rows),
    where: () => query(rows),
    limit: async (count: number) => rows.slice(0, count),
  });
  return {
    getDb: () => ({
      select: () => ({ from: (table: unknown) => query(rowsFor(table)) }),
    }),
    schema,
  };
});

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

const MIRRORED: StoredRows = {
  knowledge: [
    {
      publishedResourcePath: "context/company-brain/facts/k-1.md",
      intelligenceKind: null,
    },
  ],
};
const UNMIRRORED: StoredRows = {
  knowledge: [{ publishedResourcePath: null, intelligenceKind: null }],
};
const CAPTURE_STORED: StoredRows = { captures: [{ id: "c-1" }] };
const NOTHING_STORED: StoredRows = {};

const UPDATE_K1 = {
  knowledgeId: "k-1",
  expectedRevision: "r-1",
  title: "T",
  body: "B",
};
const SUPERSEDE_K1 = {
  supersedesId: "k-1",
  supersedesRevision: "r-1",
  title: "T",
  body: "B",
};
const CAPTURE = {
  sourceId: "s-1",
  title: "Notes",
  content: "Hello",
  externalId: "doc-1",
};
const TRANSCRIPT = { title: "Sync", transcript: "Hi", externalId: "meet-1" };
const MARKDOWN = { files: [{ path: "notes/plan.md", content: "# Plan" }] };

const ASKS_FIRST = [
  ["create-source", { title: "Team", visibility: "org" }, NOTHING_STORED],
  ["create-source", { title: "Webhook", sourceKey: "ingest-1" }, NOTHING_STORED],
  [
    "create-source",
    { title: "Webhook", config: { sourceKey: "ingest-1" } },
    NOTHING_STORED,
  ],
  [
    "create-source",
    { title: "Webhook", configJson: '{"ingestTokenHash":"abc"}' },
    NOTHING_STORED,
  ],
  ["manage-project", { operation: "delete", projectId: "p-1" }, NOTHING_STORED],
  ["update-source", { id: "s-1", status: "archived" }, NOTHING_STORED],
  ["update-source", { id: "s-1", status: "error" }, NOTHING_STORED],
  ["update-source", { id: "s-1", config: { channels: ["C1"] } }, NOTHING_STORED],
  [
    "update-source",
    { id: "s-1", configJson: '{"channels":["C1"]}' },
    NOTHING_STORED,
  ],
  ["update-source", { id: "s-1", cursor: {} }, NOTHING_STORED],
  ["update-source", { id: "s-1", policy: { trustTier: "blessed" } }, NOTHING_STORED],
  [
    "update-source",
    { id: "s-1", title: "Renamed", status: "archived" },
    NOTHING_STORED,
  ],
  [
    "write-knowledge",
    { title: "T", body: "B", publishCanonical: true },
    NOTHING_STORED,
  ],
  ["write-knowledge", UPDATE_K1, MIRRORED],
  ["write-knowledge", { ...UPDATE_K1, publishCanonical: true }, UNMIRRORED],
  ["write-knowledge", SUPERSEDE_K1, MIRRORED],
  ["import-capture", CAPTURE, CAPTURE_STORED],
  ["import-transcript", TRANSCRIPT, CAPTURE_STORED],
  ["import-markdown-files", MARKDOWN, CAPTURE_STORED],
] as const;

const RUNS_WITHOUT_ASKING = [
  ["create-source", { title: "Notes", visibility: "private" }, NOTHING_STORED],
  ["create-source", { title: "Notes" }, NOTHING_STORED],
  [
    "create-source",
    { title: "Slack", configJson: '{"channels":["C1"]}' },
    NOTHING_STORED,
  ],
  ["manage-project", { operation: "create", title: "Launch" }, NOTHING_STORED],
  [
    "manage-project",
    { operation: "update", projectId: "p-1", title: "L" },
    NOTHING_STORED,
  ],
  [
    "manage-project",
    { operation: "set-default", projectId: "p-1" },
    NOTHING_STORED,
  ],
  ["update-source", { id: "s-1", title: "Renamed" }, NOTHING_STORED],
  ["update-source", { id: "s-1", status: "paused" }, NOTHING_STORED],
  ["update-source", { id: "s-1", status: "active" }, NOTHING_STORED],
  [
    "write-knowledge",
    { title: "T", body: "B", publishCanonical: false },
    NOTHING_STORED,
  ],
  ["write-knowledge", { title: "T", body: "B" }, NOTHING_STORED],
  ["write-knowledge", UPDATE_K1, UNMIRRORED],
  ["write-knowledge", SUPERSEDE_K1, UNMIRRORED],
  ["import-capture", CAPTURE, NOTHING_STORED],
  ["import-capture", { ...CAPTURE, externalId: undefined }, CAPTURE_STORED],
  ["import-transcript", TRANSCRIPT, NOTHING_STORED],
  ["import-markdown-files", MARKDOWN, NOTHING_STORED],
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
  beforeEach(() => {
    stored.rows = {};
  });

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
    async (name, args, rows) => {
      stored.rows = rows;
      const approves = await preparedApprovalRule(name);
      expect(await approves(args, OUTSIDE_AGENT)).toBe(true);
      expect(await approves(args, IN_APP_AGENT)).toBe(false);
      expect(await approves(args, APP_UI)).toBe(false);
    },
  );

  it.each(RUNS_WITHOUT_ASKING)(
    "lets an outside agent call %s with %o without asking",
    async (name, args, rows) => {
      stored.rows = rows;
      const approves = await preparedApprovalRule(name);
      expect(await approves(args, OUTSIDE_AGENT)).toBe(false);
    },
  );

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
