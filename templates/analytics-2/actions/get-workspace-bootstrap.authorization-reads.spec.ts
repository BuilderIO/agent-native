import { beforeEach, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ context: vi.fn(), permission: vi.fn() }));

vi.mock("@agent-native/core/org", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@agent-native/core/org")
  >();
  return {
    ...original,
    resolveAppAuthorizationContext: async (...args: unknown[]) => {
      reads.context(...args);
      return {
        appId: "analytics-2",
        roles: ["editor"],
        permissions: {
          "create-project": ["editor", "manager"],
          "create-thread": ["viewer", "explorer", "editor", "manager"],
          "context-studio": ["explorer", "editor", "manager"],
          "manage-workspace": ["manager"],
        },
      };
    },
    defineAppRoles: (...args: Parameters<typeof original.defineAppRoles>) => {
      const roles = original.defineAppRoles(...args);
      return {
        ...roles,
        assertPermission: async (...permissionArgs: unknown[]) => {
          reads.permission(...permissionArgs);
        },
      };
    },
  };
});

const current = {
  orgId: "org-a",
  ownerEmail: "person@example.test",
  membership: { name: "Workspace", role: "member" },
  request: { authUserId: "user-a", userName: "Person" },
  access: { status: "assigned", orgRole: "member", roles: ["editor"] },
};
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: async () => current,
}));
import bootstrap from "./get-workspace-bootstrap";

beforeEach(() => {
  reads.context.mockClear();
  reads.permission.mockClear();
});

it("reads the caller's authorization at most once per kind for one bootstrap", async () => {
  const result = await bootstrap.run({}, {} as never);
  expect(result.features.canCreateProject).toBe(true);
  expect(result.features.contextStudio).toBe(true);
  expect(reads.context).toHaveBeenCalledTimes(1);
  expect(reads.permission).toHaveBeenCalledTimes(1);
});
