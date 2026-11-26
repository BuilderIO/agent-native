import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

const ME = "me@example.com";
const TEAMMATE = "teammate@example.com";

const stored = vi.hoisted(() => ({
  draft: null as { ownerEmail: string; requesterEmail: string } | null,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: vi.fn(() => "me@example.com"),
}));

vi.mock("../server/lib/queued-drafts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/queued-drafts.js")>()),
  getQueuedDraft: vi.fn(async () => stored.draft),
}));

const SERVED = [
  "archive-email",
  "bulk-archive",
  "create-scheduled-job",
  "find-contact",
  "get-hubspot-contact",
  "get-tracking",
  "list-inbox-threads",
  "list-labels",
  "list-org-members",
  "list-queued-drafts",
  "list-scheduled-jobs",
  "manage-snippets",
  "mark-read",
  "mark-thread-read",
  "move-email",
  "record-ai-priority-feedback",
  "resync-inbox",
  "search-emails",
  "star-email",
  "sync-inbox",
  "trash-email",
  "trigger-automations",
  "unarchive-email",
  "untrash-email",
] as const;

const APPROVED_WHEN_OUTSIDE = [
  "cancel-scheduled-email",
  "refine-ai-filter",
  "respond-calendar-invite",
  "send-scheduled-email-now",
] as const;

const ALWAYS_APPROVED = [
  "create-scheduled-send",
  "send-email",
  "send-queued-drafts",
] as const;

const IN_APP_ONLY = [
  "bootstrap-watches",
  "export-emails",
  "get-mail-settings",
  "import-gmail-signature",
  "open-queued-draft",
  "refresh-list",
  "request-code-change",
  "update-mail-settings",
  "view-composer",
] as const;

const DRAFT = { to: "client@example.org", subject: "Hello", body: "Hi there" };
const MINE = { ownerEmail: ME, requesterEmail: ME };
const FOR_TEAMMATE = { ownerEmail: TEAMMATE, requesterEmail: ME };
const FROM_TEAMMATE = { ownerEmail: ME, requesterEmail: TEAMMATE };

const MESSAGE = [{ id: "msg-1" }];

const ASKS_FIRST = [
  ["queue-email-draft", { ...DRAFT, ownerEmail: TEAMMATE }, null],
  ["update-queued-draft", { id: "qd_1", ownerEmail: TEAMMATE }, MINE],
  ["update-queued-draft", { id: "qd_1", body: "New body" }, FOR_TEAMMATE],
  ["update-queued-draft", { id: "qd_1", to: "x@example.org" }, FROM_TEAMMATE],
  ["update-queued-draft", { id: "qd_1", status: "dismissed" }, FOR_TEAMMATE],
  ["update-queued-draft", { id: "qd_1", ownerEmail: ME }, FOR_TEAMMATE],
  ["update-queued-draft", { id: "qd_1", accountEmail: ME }, FROM_TEAMMATE],
  ["update-queued-draft", { id: "qd_1", status: "sent" }, MINE],
  [
    "manage-gmail-filters",
    { operation: "create", from: "news@example.org", forward: "x@example.org" },
    null,
  ],
  ["manage-gmail-filters", { operation: "replace", id: "filter-1" }, null],
  ["manage-gmail-filters", { operation: "delete", id: "filter-1" }, null],
  [
    "manage-email-rules",
    { action: "create", sentence: "Newsletters", mode: "archive" },
    null,
  ],
  ["manage-email-rules", { action: "disable", id: "rule-1" }, null],
  ["manage-email-rules", { action: "delete", id: "rule-1" }, null],
  [
    "apply-ai-filter",
    { mode: "settings", settings: { autoFilter: true } },
    null,
  ],
  [
    "apply-ai-filter",
    { mode: "settings", settings: { autoFilterThreshold: 0.5 } },
    null,
  ],
  [
    "apply-ai-filter",
    { mode: "filter", targets: MESSAGE, comment: "Recruiter outreach" },
    null,
  ],
  [
    "apply-ai-filter",
    { mode: "keep", targets: MESSAGE, comment: "From my manager" },
    null,
  ],
  ["apply-ai-filter", { mode: "filter", targets: MESSAGE }, null],
  ["apply-ai-filter", { mode: "keep", targets: MESSAGE }, null],
] as const;

const RUNS_WITHOUT_ASKING = [
  ["queue-email-draft", { ...DRAFT, ownerEmail: " Me@Example.com " }, null],
  ["update-queued-draft", { id: "qd_1", body: "New body" }, MINE],
  ["update-queued-draft", { id: "qd_1", ownerEmail: ME, to: "x@y.org" }, MINE],
  ["update-queued-draft", { id: "qd_1", body: "New body" }, null],
  ["update-queued-draft", { id: "qd_1", status: "dismissed" }, MINE],
  ["manage-gmail-filters", { operation: "list" }, null],
  ["manage-gmail-filters", { operation: "get", id: "filter-1" }, null],
  ["manage-email-rules", { action: "list" }, null],
  ["apply-ai-filter", { mode: "settings" }, null],
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

describe("Mail actions over MCP", () => {
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
      expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
        false,
      );
      expect(
        await approves({}, { caller: "frontend" } as ActionRunContext),
      ).toBe(false);
      expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(
        true,
      );
    },
  );

  it.each(ALWAYS_APPROVED)(
    "serves %s through tool-search, still asking before every agent send",
    async (name) => {
      const approves = await approvalRule(name);
      expect(await approves({}, { caller: "tool" } as ActionRunContext)).toBe(
        true,
      );
      expect(await approves({}, { caller: "mcp" } as ActionRunContext)).toBe(
        true,
      );
    },
  );

  it.each(ASKS_FIRST)(
    "asks an outside agent before %s with %o",
    async (name, args, draft) => {
      stored.draft = draft;
      const approves = await approvalRule(name);
      expect(await approves(args, { caller: "mcp" } as ActionRunContext)).toBe(
        true,
      );
      expect(await approves(args, { caller: "tool" } as ActionRunContext)).toBe(
        false,
      );
    },
  );

  it.each(RUNS_WITHOUT_ASKING)(
    "lets an outside agent call %s without asking for %o",
    async (name, args, draft) => {
      stored.draft = draft;
      const approves = await approvalRule(name);
      expect(await approves(args, { caller: "mcp" } as ActionRunContext)).toBe(
        false,
      );
    },
  );

  it.each(IN_APP_ONLY)("keeps %s in the app, off MCP", async (name) => {
    expect((await load(name)).mcpTool).toBe(false);
  });
});
