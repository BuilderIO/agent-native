import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canWriteLocalWorkspaceResourcePath: vi.fn(),
  getOrgRoleForEmail: vi.fn(),
  resourcePut: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  WORKSPACE_OWNER: "__workspace__",
  canWriteLocalWorkspaceResourcePath: mocks.canWriteLocalWorkspaceResourcePath,
  resourcePut: mocks.resourcePut,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: mocks.getOrgRoleForEmail,
}));

import { runWithRequestContext } from "../../server/request-context.js";
import resourceWriteScript from "./write.js";

describe("resource-write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWriteLocalWorkspaceResourcePath.mockResolvedValue(false);
    mocks.getOrgRoleForEmail.mockResolvedValue("admin");
    mocks.resourcePut.mockResolvedValue({
      path: "notes/todo.md",
      size: 2,
    });
  });

  it("rejects shared writes by an organization member", async () => {
    mocks.getOrgRoleForEmail.mockResolvedValue("member");

    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "org-1" },
        () =>
          resourceWriteScript([
            "--path",
            "notes/todo.md",
            "--content",
            "hi",
            "--scope",
            "shared",
          ]),
      ),
    ).rejects.toThrow(
      "Only organization owners and admins can edit organization files",
    );

    expect(mocks.resourcePut).not.toHaveBeenCalled();
  });

  it("writes shared resources to the active organization owner", async () => {
    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        resourceWriteScript([
          "--path",
          "notes/todo.md",
          "--content",
          "hi",
          "--scope",
          "shared",
        ]),
    );

    expect(mocks.getOrgRoleForEmail).toHaveBeenCalledWith(
      "org-1",
      "alice@example.com",
    );
    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "__organization__:org-1",
      "notes/todo.md",
      "hi",
      "text/markdown",
    );
  });
});
