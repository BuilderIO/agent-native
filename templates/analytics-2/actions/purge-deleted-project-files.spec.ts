import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  purge: vi.fn(),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "viewer@example.test",
    orgId: "workspace-fixture",
  }),
  workspaceAccess: { assertPermission: mocks.assertPermission },
}));
vi.mock("../server/model/project-file-cleanup.js", () => ({
  purgeDeletedProjectFiles: mocks.purge,
}));

import action from "./purge-deleted-project-files.js";

it("refuses a workspace member without project-write permission before accessing file storage", async () => {
  mocks.assertPermission.mockRejectedValue(
    Object.assign(new Error("Permission denied"), { statusCode: 403 }),
  );
  await expect(
    action.run({ projectId: "deleted-project" }, {} as never),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(mocks.purge).not.toHaveBeenCalled();
});
