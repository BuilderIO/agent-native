import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

const SERVED = [
  "ask-brain",
  "enqueue-captures-distillation",
  "enqueue-distillation",
  "get-brain-health",
  "get-capture",
  "get-knowledge",
  "get-settings",
  "get-source",
  "import-capture",
  "import-markdown-files",
  "import-transcript",
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

const ASKS_FIRST = [
  ["create-source", { title: "Team", visibility: "org" }],
  ["create-source", { title: "Webhook", sourceKey: "ingest-1" }],
  ["manage-project", { operation: "delete", projectId: "p-1" }],
  ["update-source", { id: "s-1", status: "archived" }],
  ["update-source", { id: "s-1", status: "error" }],
  ["update-source", { id: "s-1", config: { channels: ["C1"] } }],
  ["update-source", { id: "s-1", configJson: '{"channels":["C1"]}' }],
  ["update-source", { id: "s-1", cursor: {} }],
  ["update-source", { id: "s-1", policy: { trust: "high" } }],
  ["update-source", { id: "s-1", title: "Renamed", status: "archived" }],
  ["write-knowledge", { title: "T", body: "B", publishCanonical: true }],
] as const;

const RUNS_WITHOUT_ASKING = [
  ["create-source", { title: "Notes", visibility: "private" }],
  ["create-source", { title: "Notes" }],
  ["manage-project", { operation: "create", title: "Launch" }],
  ["manage-project", { operation: "update", projectId: "p-1", title: "L" }],
  ["manage-project", { operation: "set-default", projectId: "p-1" }],
  ["update-source", { id: "s-1", title: "Renamed" }],
  ["update-source", { id: "s-1", status: "paused" }],
  ["update-source", { id: "s-1", status: "active" }],
  ["write-knowledge", { title: "T", body: "B", publishCanonical: false }],
  ["write-knowledge", { title: "T", body: "B" }],
] as const;

const ALIASES = [
  ["get-brain-settings", "get-settings"],
  ["update-brain-settings", "set-settings"],
] as const;

type Exposure = {
  mcpTool?: boolean | "search";
  needsApproval?:
    | boolean
    | ((args: unknown, ctx?: ActionRunContext) => boolean | Promise<boolean>);
};

async function load(name: string): Promise<Exposure> {
  return ((await import(`./${name}.ts`)) as { default: Exposure }).default;
}

async function approvalRule(name: string) {
  const action = await load(name);
  expect(action.mcpTool).toBe("search");
  const approves = action.needsApproval;
  if (typeof approves !== "function") {
    throw new Error(`${name} has no approval rule`);
  }
  return approves;
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
      const approves = await approvalRule(name);
      expect(await approves({}, IN_APP_AGENT)).toBe(false);
      expect(await approves({}, APP_UI)).toBe(false);
      expect(await approves({}, OUTSIDE_AGENT)).toBe(true);
    },
  );

  it.each(ASKS_FIRST)(
    "asks an outside agent before %s with %o",
    async (name, args) => {
      const approves = await approvalRule(name);
      expect(await approves(args, OUTSIDE_AGENT)).toBe(true);
      expect(await approves(args, IN_APP_AGENT)).toBe(false);
      expect(await approves(args, APP_UI)).toBe(false);
    },
  );

  it.each(RUNS_WITHOUT_ASKING)(
    "lets an outside agent call %s with %o without asking",
    async (name, args) => {
      const approves = await approvalRule(name);
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
