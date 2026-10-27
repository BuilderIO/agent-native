import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  access: { role: "editor", resource: { expiresAt: null as string | null } },
  read: vi.fn(() => {
    throw new Error("content boundary reached");
  }),
}));
vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  assertAccess: vi.fn(async () => boundary.access),
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => boundary.read(),
}));
vi.mock("../server/lib/app-activity.js", () => ({
  loadRecordingAppActivity: () => boundary.read(),
}));
vi.mock("@agent-native/core/application-state", async (original) => ({
  ...(await original<typeof import("@agent-native/core/application-state")>()),
  readAppState: async () => boundary.read(),
  writeAppState: async () => boundary.read(),
  compareAndSetManyAppState: async () => boundary.read(),
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: async () => boundary.read(),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getActiveOrganizationId: async () => null,
  getCurrentOwnerEmail: () => "viewer@example.test",
  ownerEmailMatches: vi.fn(),
}));

const loaders = {
  "remove-silences": () => import("./remove-silences.js"),
  "request-transcript": () => import("./request-transcript.js"),
  "get-recording-app-activity": () => import("./get-recording-app-activity.js"),
  "generate-workflow": () => import("./generate-workflow.js"),
  "regenerate-chapters": () => import("./regenerate-chapters.js"),
  "regenerate-summary": () => import("./regenerate-summary.js"),
  "regenerate-title": () => import("./regenerate-title.js"),
  "remove-filler-words": () => import("./remove-filler-words.js"),
  "export-to-brain": () => import("./export-to-brain.js"),
  "get-recording-insights": () => import("./get-recording-insights.js"),
  "list-viewers": () => import("./list-viewers.js"),
  "list-clip-views": () => import("./list-clip-views.js"),
};
const readers = [
  "remove-silences",
  "request-transcript",
  "get-recording-app-activity",
  "generate-workflow",
  "regenerate-chapters",
  "regenerate-summary",
  "regenerate-title",
  "remove-filler-words",
  "export-to-brain",
  "get-recording-insights",
  "list-viewers",
  "list-clip-views",
] as const;

describe.each(readers)("%s recording lifecycle", (name) => {
  beforeEach(() => {
    boundary.read.mockClear();
    boundary.access = { role: "editor", resource: { expiresAt: null } };
  });
  it.each(["2000-01-01T00:00:00Z", "not-a-date"])(
    "denies an expired nonowner before reading or queueing content (%s)",
    async (expiresAt) => {
      const { default: action } = await loaders[name]();
      boundary.access.resource.expiresAt = expiresAt;
      await expect(
        action.run({ recordingId: "fake-recording", kind: "pr" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(boundary.read).not.toHaveBeenCalled();
    },
  );
  it.each([
    { role: "editor", expiresAt: null },
    { role: "owner", expiresAt: "2000-01-01T00:00:00Z" },
    { role: "owner", expiresAt: "not-a-date" },
  ])("preserves content access for $role with $expiresAt", async (access) => {
    const { default: action } = await loaders[name]();
    boundary.access = {
      role: access.role,
      resource: { expiresAt: access.expiresAt },
    };
    await expect(
      action.run({ recordingId: "fake-recording", kind: "pr" }),
    ).rejects.toThrow("content boundary reached");
    expect(boundary.read).toHaveBeenCalled();
  });
});
