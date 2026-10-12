import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action with storage and the database stubbed.
 */

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  uploadFile: vi.fn(async () => ({ url: "https://store.example/new.png" })),
  getDefaultRecordingVisibility: vi.fn(
    async (_orgId?: string, _userEmail?: string, explicit?: string) =>
      explicit ?? "private",
  ),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async () => undefined,
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...(args as [])),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  getDefaultRecordingVisibility: (...args: unknown[]) =>
    mocks.getDefaultRecordingVisibility(
      ...(args as [string?, string?, string?]),
    ),
  nanoid: () => `id-${mocks.rows.length + 1}`,
  requireOrganizationAccess: async () => ({ organizationId: "org-1" }),
  stringifySpaceIds: () => "[]",
}));
vi.mock("./lib/recording-scope.js", () => ({
  validateRecordingScope: async () => [],
}));
vi.mock("../server/db/index.js", () => ({
  schema: { recordings: {} },
  getDb: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        mocks.rows.push(row);
      },
    }),
  }),
}));

import action from "./create-screenshot";

const PNG = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString("base64")}`;

function run(args: Record<string, unknown> = {}) {
  const parsed = (action as any).schema.parse({
    dataUrl: PNG,
    width: 10,
    height: 10,
    ...args,
  });
  return (action as any).run(parsed, { userEmail: "owner@example.com" });
}

beforeEach(() => {
  mocks.rows = [];
  mocks.uploadFile.mockClear();
  mocks.getDefaultRecordingVisibility.mockClear();
});

describe("create-screenshot", () => {
  it("returns the gated route, never the storage URL", async () => {
    const result = await run();
    expect(result.imageUrl).toMatch(/^\/api\/thumbnail\//);
    expect(JSON.stringify(result)).not.toContain("store.example");
  });

  it("passes explicit visibility to the resolver", async () => {
    await run({ visibility: "org" });

    expect(mocks.getDefaultRecordingVisibility).toHaveBeenCalledWith(
      "org-1",
      "owner@example.com",
      "org",
    );
    expect(mocks.rows[0]?.visibility).toBe("org");
  });
});
