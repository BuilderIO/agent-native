import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

const SERVED = [
  "add-slide-comment",
  "analyze-brand-assets",
  "apply-design-system",
  "audit-contrast",
  "check-image-gen",
  "clone-creative-context-deck",
  "create-deck-from-template",
  "create-design-system",
  "export-google-slides",
  "export-html",
  "export-pptx",
  "generate-image-api",
  "get-deck-template",
  "get-deck-version",
  "get-layout-overflows",
  "image-gen-status",
  "import-code",
  "import-design-project",
  "import-document",
  "import-docx",
  "import-file",
  "import-from-url",
  "import-google-doc",
  "import-google-slides-reference",
  "index-design-system-with-builder",
  "list-deck-share-links",
  "list-deck-templates",
  "list-deck-versions",
  "list-google-fonts",
  "list-slide-comments",
  "search-images",
  "search-logos",
  "sync-design-system-with-builder",
  "toggle-slide-comment-reaction",
  "update-deck-aspect-ratio",
  "update-design-system",
  "update-slide-comment",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "delete-design-system",
  "revoke-deck-share-link",
] as const;

const ASKS_FIRST = [
  [
    "import-pptx",
    { filePath: "deck.pptx", deckId: "d-1", replaceExisting: true },
  ],
] as const;

const RUNS_WITHOUT_ASKING = [
  ["import-pptx", { filePath: "deck.pptx" }],
  ["import-pptx", { filePath: "deck.pptx", title: "Imported" }],
  [
    "import-pptx",
    { filePath: "deck.pptx", deckId: "d-1", replaceExisting: false },
  ],
] as const;

const IN_APP_ONLY = [
  "delete-slide-comment",
  "disconnect-google-docs",
  "get-design-system-tier-limit",
  "get-slides-notification-prefs",
  "set-default-design-system",
  "set-workspace-defaults",
  "update-slides-notification-prefs",
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
const OTHER_OUTSIDE_CALLERS = [
  { caller: "http" },
  { caller: "a2a" },
  { caller: "cli" },
  { caller: "frontend", networkProtocol: "a2a" },
] as ActionRunContext[];

describe("Slides actions over MCP", () => {
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
      for (const ctx of OTHER_OUTSIDE_CALLERS) {
        expect(await approves({}, ctx)).toBe(true);
      }
    },
  );

  it.each(ASKS_FIRST)(
    "asks an outside agent before %s with %o",
    async (name, args) => {
      const approves = await preparedApprovalRule(name);
      expect(await approves(args, OUTSIDE_AGENT)).toBe(true);
      for (const ctx of OTHER_OUTSIDE_CALLERS) {
        expect(await approves(args, ctx)).toBe(true);
      }
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
