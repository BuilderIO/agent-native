import { beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  access: vi.fn(),
  execute: vi.fn(),
  configured: vi.fn(),
  unbuilt: vi.fn(),
}));
vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute: boundary.execute }),
}));
vi.mock("../actions.js", () => ({ requireOrgMember: boundary.access }));
vi.mock("../workspace-app-access.js", () => ({
  listConfiguredWorkspaceApps: boundary.configured,
  unbuiltWorkspaceAppIds: boundary.unbuilt,
}));
import action from "./list-workspace-app-access.js";
const ctx = { caller: "frontend" } as const;
describe("workspace access listing runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    boundary.access.mockResolvedValue({ orgId: "personal-org" });
    boundary.execute.mockResolvedValue({ rows: [] });
    boundary.configured.mockReturnValue([]);
    boundary.unbuilt.mockReturnValue([]);
  });
  it("refuses unauthorized callers before touching app data", async () => {
    const refusal = new Error("Organization membership required");
    boundary.access.mockRejectedValue(refusal);
    await expect(action.run({}, ctx)).rejects.toBe(refusal);
    expect(boundary.execute).not.toHaveBeenCalled();
  });
  it("uses the authenticated org and preserves its disabled policy over a manifest default", async () => {
    boundary.execute.mockResolvedValue({
      rows: [
        {
          id: "personal-app",
          name: "Personal",
          path: "/personal",
          org_enabled: false,
          visibility: "public",
        },
        {
          id: "retired-app",
          name: "Retired",
          path: "/retired",
          org_enabled: true,
        },
      ],
    });
    boundary.configured.mockReturnValue([
      {
        id: "personal-app",
        name: "Manifest",
        description: null,
        path: "/manifest",
      },
      { id: "new-app", name: "New", description: null, path: "/new" },
    ]);
    boundary.unbuilt.mockReturnValue(["retired-app"]);
    const result = await action.run({}, ctx);
    expect(boundary.access).toHaveBeenCalledWith(expect.anything(), true);
    expect(boundary.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["personal-org"] }),
    );
    expect(result.apps).toEqual([
      {
        id: "new-app",
        name: "New",
        description: null,
        path: "/new",
        mode: "all",
      },
      {
        id: "personal-app",
        name: "Personal",
        description: null,
        path: "/personal",
        mode: "disabled",
      },
    ]);
  });
  it.each([false, 0, "false", "0"])(
    "keeps disabled policy represented by %j",
    async (org_enabled) => {
      boundary.execute.mockResolvedValue({
        rows: [
          {
            id: "personal-app",
            name: "Personal",
            org_enabled,
            visibility: "private",
          },
        ],
      });
      expect((await action.run({}, ctx)).apps[0]?.mode).toBe("disabled");
    },
  );
});
