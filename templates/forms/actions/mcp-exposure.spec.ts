import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

const SERVED = [
  "export-responses",
  "get-form",
  "list-forms",
  "list-responses",
  "patch-form-fields",
  "preview-form",
  "response-insights",
  "restore-form",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "delete-form",
  "promote-community-submission",
  "retry-response-deliveries",
] as const;

const IN_APP_ONLY = ["refresh-list", "show-response-insight"] as const;

const webhook = {
  id: "i-1",
  type: "webhook",
  name: "CRM",
  url: "https://hooks.example.com/forms",
  enabled: true,
};

const ASKS_FIRST = [
  ["update-form", { id: "f-1", settings: { integrations: [webhook] } }],
  ["update-form", { id: "f-1", settings: { integrations: [] } }],
  [
    "update-form",
    {
      id: "f-1",
      title: "Signup",
      settings: { submitText: "Send", integrations: [webhook] },
    },
  ],
] as const;

const RUNS_WITHOUT_ASKING = [
  ["update-form", { id: "f-1", title: "Signup" }],
  ["update-form", { id: "f-1", status: "published" }],
  ["update-form", { id: "f-1", settings: { completionMode: "message" } }],
  ["update-form", { id: "f-1", settings: { emailOnNewResponses: true } }],
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

describe("Forms actions over MCP", () => {
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

  it.each(IN_APP_ONLY)("keeps %s in the app, off MCP", async (name) => {
    expect((await load(name)).mcpTool).toBe(false);
  });
});
