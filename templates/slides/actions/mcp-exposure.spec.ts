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
  "import-pptx",
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

const IN_APP_ONLY = [
  "disconnect-google-docs",
  "get-design-system-tier-limit",
  "get-slides-notification-prefs",
  "set-default-design-system",
  "set-workspace-defaults",
  "update-slides-notification-prefs",
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

  it("serves delete-slide-comment through tool-search and keeps its rule for other people's comments", async () => {
    const action = await load("delete-slide-comment");
    expect(action.mcpTool).toBe("search");
    const approves = action.needsApproval;
    if (typeof approves !== "function") {
      throw new Error("delete-slide-comment has no approval rule");
    }
    expect(await approves({ id: "c-1", deckId: "d-1" }, APP_UI)).toBe(false);
  });

  it.each(IN_APP_ONLY)("keeps %s in the app, off MCP", async (name) => {
    expect((await load(name)).mcpTool).toBe(false);
  });
});
