import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canWriteLocalWorkspaceResourcePath: vi.fn(),
  isLegacyOrganizationWorkspaceFile: vi.fn(),
  resourceDelete: vi.fn(),
  resourceDeleteByPath: vi.fn(),
  resourceGetByPath: vi.fn(),
  getOrgRoleForEmail: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  canWriteLocalWorkspaceResourcePath: mocks.canWriteLocalWorkspaceResourcePath,
  isLegacyOrganizationWorkspaceFile: mocks.isLegacyOrganizationWorkspaceFile,
  resourceDelete: mocks.resourceDelete,
  resourceDeleteByPath: mocks.resourceDeleteByPath,
  resourceGetByPath: mocks.resourceGetByPath,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: mocks.getOrgRoleForEmail,
}));

import { runWithRequestContext } from "../../server/request-context.js";
import deleteResourceScript from "./delete.js";

describe("resource-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceDeleteByPath.mockResolvedValue(true);
    mocks.resourceDelete.mockResolvedValue(true);
    mocks.isLegacyOrganizationWorkspaceFile.mockReturnValue(true);
    mocks.getOrgRoleForEmail.mockResolvedValue("admin");
  });

  it("deletes the active organization resource and its legacy fallback", async () => {
    const organizationResource = { id: "org-resource" };
    const legacyResource = { id: "legacy-resource" };
    mocks.resourceGetByPath
      .mockResolvedValueOnce(organizationResource)
      .mockResolvedValueOnce(legacyResource);

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        deleteResourceScript(["--path", "notes/todo.md", "--scope", "shared"]),
    );

    expect(mocks.resourceDeleteByPath).toHaveBeenCalledWith(
      "__organization__:org-1",
      "notes/todo.md",
    );
    expect(mocks.resourceDelete).toHaveBeenCalledWith("legacy-resource");
  });

  it("does not delete an unrelated global default for an organization", async () => {
    mocks.resourceGetByPath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "global-default" });
    mocks.isLegacyOrganizationWorkspaceFile.mockReturnValue(false);

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "org-1" },
      () =>
        deleteResourceScript(["--path", "notes/todo.md", "--scope", "shared"]),
    );

    expect(mocks.resourceDeleteByPath).not.toHaveBeenCalled();
    expect(mocks.resourceDelete).not.toHaveBeenCalled();
  });

  it("rejects shared deletion by an organization member", async () => {
    mocks.getOrgRoleForEmail.mockResolvedValue("member");

    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "org-1" },
        () =>
          deleteResourceScript([
            "--path",
            "notes/todo.md",
            "--scope",
            "shared",
          ]),
      ),
    ).rejects.toThrow(
      "Only organization owners and admins can edit organization files",
    );

    expect(mocks.resourceGetByPath).not.toHaveBeenCalled();
    expect(mocks.resourceDeleteByPath).not.toHaveBeenCalled();
  });
});
