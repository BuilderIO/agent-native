import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

const SERVED = [
  "analyze-collection-style",
  "archive-library",
  "clone-creative-context-asset",
  "create-collection",
  "create-folder",
  "create-generation-preset",
  "create-generation-session",
  "create-library",
  "create-library-from-preset",
  "create-template",
  "describe-asset",
  "duplicate-library",
  "duplicate-template",
  "edit-image",
  "export-image",
  "extract-palette-from-references",
  "generate-image",
  "generate-image-batch",
  "generate-video",
  "get-asset",
  "get-generation-run",
  "get-generation-session",
  "get-library",
  "get-library-access",
  "get-template",
  "import-asset-from-url",
  "import-style-from-url",
  "list-assets",
  "list-draft-assets",
  "list-generation-presets",
  "list-generation-runs",
  "list-generation-sessions",
  "list-libraries",
  "list-library-presets",
  "list-templates",
  "match-library",
  "prepare-generation-session-continuation",
  "refine-image",
  "refresh-generation-run",
  "rerun-generation-run",
  "restyle-image",
  "save-generated-image",
  "search-assets",
  "set-canonical-logo",
  "unarchive-library",
  "update-asset",
  "update-collection",
  "update-folder",
  "update-generation-preset",
  "update-generation-session",
  "update-library",
  "update-template",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "associate-template",
  "delete-asset",
  "delete-assets",
  "delete-folder",
  "delete-generation-preset",
  "delete-library",
  "delete-template",
] as const;

const IN_APP_ONLY = [
  "dismiss-variant-slots",
  "export-audit-csv",
  "get-assets-notification-prefs",
  "get-audit-run",
  "get-image-generation-config",
  "is-audit-admin",
  "list-audit-runs",
  "update-assets-notification-prefs",
] as const;

const ALIASES = [
  ["export-asset", "export-image"],
  ["save-generated-asset", "save-generated-image"],
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

describe("Assets actions over MCP", () => {
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

  it("asks an outside agent before merging duplicate templates, but not for a dry run", async () => {
    const approves = await approvalRule("merge-duplicate-templates");
    expect(await approves({ dryRun: false }, OUTSIDE_AGENT)).toBe(true);
    expect(await approves({}, OUTSIDE_AGENT)).toBe(true);
    expect(await approves({ dryRun: true }, OUTSIDE_AGENT)).toBe(false);
    expect(await approves({ dryRun: false }, IN_APP_AGENT)).toBe(false);
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
