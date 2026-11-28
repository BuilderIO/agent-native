import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

const SERVED = [
  "add-builder-screens",
  "analyze-brand-assets",
  "apply-component-prop-edit",
  "apply-design-state",
  "apply-design-token-edit",
  "apply-source-edit",
  "apply-visual-edit",
  "capture-design-state",
  "create-component",
  "create-design-state",
  "detach-component-instance",
  "duplicate-design",
  "edit-native-shader",
  "export-design-as-figma-svg",
  "export-hubspot-html",
  "export-html",
  "export-pdf",
  "export-svg",
  "export-zip",
  "fill-figma-paste-image",
  "get-builder-deploy-status",
  "get-code-layer-projection",
  "get-component-details",
  "get-design-surface-index",
  "get-design-version",
  "get-figma-design-context",
  "get-figma-styles",
  "get-native-render-contexts",
  "get-native-shader-approvals",
  "get-shader",
  "get-visual-edit-collaboration",
  "hydrate-figma-paste-images",
  "import-code",
  "import-design-project",
  "import-design-source",
  "import-design-tokens",
  "import-document",
  "import-figma-clipboard",
  "import-figma-frame",
  "import-from-url",
  "import-github",
  "index-components",
  "insert-design-native-asset",
  "insert-figma-library-asset",
  "list-builder-edits",
  "list-design-components",
  "list-design-native-assets",
  "list-design-source-capabilities",
  "list-design-states",
  "list-design-versions",
  "list-figma-library-assets",
  "list-google-fonts",
  "list-source-files",
  "move-design-element",
  "prepare-native-scene-export",
  "preview-component-prop-edit",
  "preview-design-token-edit",
  "preview-source-edit",
  "queue-builder-edit",
  "read-source-file",
  "rename-component",
  "restore-design-version",
  "save-design-as-template",
  "set-layout-grid",
  "swap-component-instance",
  "sync-builder-app",
  "take-design-screenshot",
  "update-breakpoint",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "apply-builder-edits",
  "create-builder-app",
  "create-design-branch",
  "delete-design-state",
  "delete-design-template",
  "deploy-builder-app",
  "deploy-design-preview",
  "push-builder-app",
  "send-builder-message",
  "update-visual-edit-preview",
] as const;

const REPLAY_SCREENSHOT = {
  attachmentRef: "attachment-1",
  replayId: "replay-1",
  capturedAt: "2026-11-27T12:00:00.000Z",
  app: "mail",
  route: "/inbox",
  offsetMs: 0,
  viewportWidth: 1280,
  viewportHeight: 800,
  eventCount: 3,
};

const CREATED_SHELL = {
  title: "Untitled design",
  description: null,
  data: "{}",
  dataOperationRevisions: "{}",
  liveCollaborationEnabled: false,
  projectType: "prototype",
  createdAt: "2026-11-27T12:00:00.000Z",
  updatedAt: "2026-11-27T12:00:00.000Z",
  ownerEmail: "owner@example.com",
  orgId: null,
  visibility: "private",
};

const ASKS_FIRST = [
  [
    "add-session-replay-screenshots-to-board",
    {
      screenshots: [REPLAY_SCREENSHOT],
      allowEncryptedPublicUploadFallback: true,
    },
  ],
  ["update-visual-edit-collaboration", { designId: "d-1", enabled: true }],
  ["delete-design", { id: "d-1" }],
] as const;

const RUNS_WITHOUT_ASKING = [
  [
    "add-session-replay-screenshots-to-board",
    { screenshots: [REPLAY_SCREENSHOT] },
  ],
  [
    "add-session-replay-screenshots-to-board",
    {
      screenshots: [REPLAY_SCREENSHOT],
      allowEncryptedPublicUploadFallback: false,
    },
  ],
  ["update-visual-edit-collaboration", { designId: "d-1", enabled: false }],
  ["delete-design", { id: "d-1", expectedCreatedShell: CREATED_SHELL }],
] as const;

const IN_APP_ONLY = [
  "cancel-native-local-export",
  "change-appearance",
  "connect-assets-mcp",
  "connect-builder-app",
  "get-getting-started",
  "get-native-local-export",
  "get-view-settings",
  "go-to-main-component",
  "list-local-files",
  "migrate-board-objects-to-file",
  "migrate-inline-design-to-app",
  "open-builder-branch-design",
  "open-component-source",
  "place-figma-frames",
  "propose-node-rewrite",
  "read-local-file",
  "refresh-localhost-preview-token",
  "request-localhost-write-consent",
  "request-native-local-export",
  "resolve-selection-source",
  "revoke-localhost-write-consent",
  "set-active-breakpoint",
  "update-view-settings",
  "write-local-file",
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

describe("Design actions over MCP", () => {
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
