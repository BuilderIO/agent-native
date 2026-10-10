import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getRequestUserEmail: vi.fn(),
  queueCleanup: vi.fn(),
  withMutation: vi.fn(),
  selectedRows: [] as Array<Array<{ id?: string; blobHandle: string }>>,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return { ...actual, assertAccess: mocks.assertAccess };
});
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  queueVisualEditSnapshotBlobCleanupInTransaction: mocks.queueCleanup,
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction: mocks.withMutation,
}));

import action from "./discard-journey-canvas-frame-import.js";

const run = action.run as (value: unknown) => Promise<unknown>;

describe("discard-journey-canvas-frame-import", () => {
  it("queues only handles with no remaining screenshot row in the Design", async () => {
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.queueCleanup.mockResolvedValue(undefined);
    mocks.selectedRows = [
      [
        { id: "jcu_shared", blobHandle: "shared-handle" },
        { id: "jcu_orphan", blobHandle: "orphan-handle" },
      ],
      [{ blobHandle: "shared-handle" }],
    ];
    const tx = {
      select: vi.fn(() => {
        const rows = mocks.selectedRows.shift() ?? [];
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
          for: vi.fn(() => builder),
          then: (
            resolve: (value: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      }),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    };
    mocks.withMutation.mockImplementation(
      async (_designId: string, callback: (value: typeof tx) => unknown) =>
        callback(tx),
    );

    await run({ designId: "design-1", importId: "import-1" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "editor",
    );
    expect(mocks.queueCleanup).toHaveBeenCalledWith(tx, ["orphan-handle"]);
  });
});
