import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  access: { role: "editor", resource: { expiresAt: null as string | null } },
  lookup: false,
  mutate: vi.fn(() => {
    throw new Error("content mutation reached");
  }),
}));
vi.mock("@agent-native/core/action", async (original) => ({
  ...(await original<typeof import("@agent-native/core/action")>()),
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  assertAccess: vi.fn(async () => boundary.access),
}));
vi.mock("@agent-native/core/server/request-context", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/request-context")
  >()),
  getRequestUserEmail: () => "viewer@example.test",
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => {
    if (!boundary.lookup) return boundary.mutate();
    const query = {
      from: () => query,
      where: () => query,
      limit: async () => [{ id: "fake-id", recordingId: "fake-recording" }],
    };
    return {
      select: () => query,
      update: () => boundary.mutate(),
      delete: () => boundary.mutate(),
      transaction: () => boundary.mutate(),
    };
  },
}));
const mutations = [
  {
    name: "add-recording-to-space",
    load: () => import("./add-recording-to-space.js"),
    args: { recordingId: "fake-recording", spaceId: "fake-space", op: "add" },
    lookup: false,
  },
  {
    name: "archive-recording",
    load: () => import("./archive-recording.js"),
    args: { id: "fake-id" },
    lookup: false,
  },
  {
    name: "burn-recording-redactions",
    load: () => import("./burn-recording-redactions.js"),
    args: { recordingId: "fake-recording" },
    lookup: false,
  },
  {
    name: "clear-edits",
    load: () => import("./clear-edits.js"),
    args: { recordingId: "fake-recording" },
    lookup: false,
  },
  {
    name: "create-cta",
    load: () => import("./create-cta.js"),
    args: {
      recordingId: "fake-recording",
      label: "Fake CTA",
      url: "https://example.test/fake",
    },
    lookup: true,
  },
  {
    name: "delete-agent-recording-if-unpromoted",
    load: () => import("./delete-agent-recording-if-unpromoted.js"),
    args: { id: "fake-id" },
    lookup: false,
  },
  {
    name: "delete-cta",
    load: () => import("./delete-cta.js"),
    args: { id: "fake-id" },
    lookup: true,
  },
  {
    name: "move-recording",
    load: () => import("./move-recording.js"),
    args: { id: "fake-id", folderId: null },
    lookup: false,
  },
  {
    name: "react-to-recording",
    load: () => import("./react-to-recording.js"),
    args: {
      recordingId: "fake-recording",
      emoji: "fake-reaction",
      videoTimestampMs: 0,
    },
    lookup: false,
  },
  {
    name: "restore-recording",
    load: () => import("./restore-recording.js"),
    args: { id: "fake-id" },
    lookup: false,
  },
  {
    name: "save-browser-diagnostics",
    load: () => import("./save-browser-diagnostics.js"),
    args: { recordingId: "fake-recording" },
    lookup: false,
  },
  {
    name: "save-bug-report-context",
    load: () => import("./save-bug-report-context.js"),
    args: { recordingId: "fake-recording" },
    lookup: false,
  },
  {
    name: "save-recording-app-activity",
    load: () => import("./save-recording-app-activity.js"),
    args: { recordingId: "fake-recording" },
    lookup: false,
  },
  {
    name: "save-screenshot-edits",
    load: () => import("./save-screenshot-edits.js"),
    args: {
      recordingId: "fake-recording",
      mediaRevision: "fake-revision",
      dataUrl: "fake-image",
      baseDataUrl: "fake-image",
    },
    lookup: false,
  },
  {
    name: "set-thumbnail",
    load: () => import("./set-thumbnail.js"),
    args: { recordingId: "fake-recording", kind: "frame", timeMs: 0 },
    lookup: false,
  },
  {
    name: "split-recording",
    load: () => import("./split-recording.js"),
    args: { recordingId: "fake-recording", atMs: 500 },
    lookup: false,
  },
  {
    name: "set-recording-overlays",
    load: () => import("./set-recording-overlays.js"),
    args: { recordingId: "fake-recording", overlays: [] },
    lookup: false,
  },
  {
    name: "set-recording-trims",
    load: () => import("./set-recording-trims.js"),
    args: { recordingId: "fake-recording", trims: [] },
    lookup: false,
  },
  {
    name: "tag-recording",
    load: () => import("./tag-recording.js"),
    args: { recordingId: "fake-recording", tag: "Fake tag", op: "add" },
    lookup: false,
  },
  {
    name: "trash-recording",
    load: () => import("./trash-recording.js"),
    args: { id: "fake-id" },
    lookup: false,
  },
  {
    name: "trim-recording",
    load: () => import("./trim-recording.js"),
    args: { recordingId: "fake-recording", startMs: 0, endMs: 1000 },
    lookup: false,
  },
  {
    name: "undo-edit",
    load: () => import("./undo-edit.js"),
    args: { recordingId: "fake-recording" },
    lookup: false,
  },
  {
    name: "update-cta",
    load: () => import("./update-cta.js"),
    args: { id: "fake-id", label: "Fake CTA" },
    lookup: true,
  },
  {
    name: "burn worker",
    load: async () => ({
      default: {
        run: (await import("./burn-recording-redactions.js")).burnRedactionsFor,
      },
    }),
    args: { recordingId: "fake-recording", ownerEmail: "viewer@example.test" },
    lookup: false,
  },
];
function run(action: unknown, args: Record<string, unknown>) {
  return (
    action as { run: (input: Record<string, unknown>) => Promise<unknown> }
  ).run(args);
}
describe.each(mutations)("$name expiry boundary", ({ load, args, lookup }) => {
  beforeEach(() => {
    boundary.access = { role: "editor", resource: { expiresAt: null } };
    boundary.lookup = lookup;
    boundary.mutate.mockClear();
  });
  it.each(["2000-01-01T00:00:00Z", "not-a-date"])(
    "refuses expired editor mutation (%s)",
    async (expiresAt) => {
      const { default: action } = await load();
      boundary.access.resource.expiresAt = expiresAt;
      await expect(run(action, args)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(boundary.mutate).not.toHaveBeenCalled();
    },
  );
  it.each([
    { role: "editor", expiresAt: null },
    { role: "owner", expiresAt: "2000-01-01T00:00:00Z" },
    { role: "owner", expiresAt: "not-a-date" },
  ])("retains $role access ($expiresAt)", async ({ role, expiresAt }) => {
    const { default: action } = await load();
    boundary.access = { role, resource: { expiresAt } };
    await expect(run(action, args)).rejects.toThrow("content mutation reached");
    expect(boundary.mutate).toHaveBeenCalledOnce();
  });
});
