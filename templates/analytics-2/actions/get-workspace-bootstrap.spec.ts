import { beforeEach, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ current: vi.fn(), capabilities: vi.fn() }));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: access.current,
  currentWorkspaceCapabilities: access.capabilities,
}));
import bootstrap from "./get-workspace-bootstrap";

beforeEach(() => {
  access.current.mockReset();
  access.capabilities.mockReset();
});

it("returns the authorized identity and its actual navigation permissions", async () => {
  const current = {
    orgId: "org-a",
    ownerEmail: "person@example.test",
    membership: { name: "Workspace" },
    request: { authUserId: "user-a", userName: "Person" },
    access: { orgRole: "member" },
  };
  access.current.mockResolvedValue(current);
  access.capabilities.mockResolvedValue({
    allows: (permission: string) => permission === "create-thread",
    isManagerOrAbove: false,
  });
  const result = await bootstrap.run({}, {} as never);
  expect(result.workspace).toEqual({ id: "org-a", name: "Workspace" });
  expect(result.user).toEqual({
    id: "user-a",
    name: "Person",
    email: "person@example.test",
  });
  expect(result.features).toMatchObject({
    isAdmin: false,
    canCreateProject: false,
    canCreateThread: true,
    contextStudio: false,
    canExplore: false,
  });
  expect(access.capabilities).toHaveBeenCalledWith(current);
});

it("does not return workspace identity when access is denied", async () => {
  access.current.mockRejectedValue(new Error("Access denied"));
  await expect(bootstrap.run({}, {} as never)).rejects.toThrow("Access denied");
  expect(access.capabilities).not.toHaveBeenCalled();
});

it("exposes exploration navigation when the workspace permission allows it", async () => {
  access.current.mockResolvedValue({
    orgId: "org-a",
    ownerEmail: "person@example.test",
    membership: { name: "Workspace" },
    request: { authUserId: "user-a", userName: "Person" },
    access: { orgRole: "member" },
  });
  access.capabilities.mockResolvedValue({
    allows: (permission: string) => permission === "context-studio",
    isManagerOrAbove: false,
  });
  const result = await bootstrap.run({}, {} as never);
  expect(result.features.contextStudio).toBe(true);
  expect(result.features.canExplore).toBe(true);
});
