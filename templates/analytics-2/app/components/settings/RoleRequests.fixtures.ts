import { vi } from "vitest";

import type { RoleRequest } from "../../../app/lib/model/role-request-contracts.js";

export function roleRequest(
  id: string,
  requestedBy: string,
  status: RoleRequest["status"] = "pending",
): RoleRequest {
  return {
    id,
    requestedBy,
    requestedRole: "admin",
    status,
    requestedAt: "2026-11-10T12:00:00.000Z",
    resolvedAt: status === "pending" ? null : "2026-11-10T13:00:00.000Z",
    resolvedBy: status === "pending" ? null : "admin@example.test",
  };
}

/** What the mocked data hooks answer with; a test sets it before it mounts. */
export const roleRequests = {
  isAdmin: false,
  loading: false,
  requests: [] as RoleRequest[],
  callAction: vi.fn(),
  refetch: vi.fn(async () => undefined),
  reset() {
    this.isAdmin = false;
    this.loading = false;
    this.requests = [];
    this.callAction.mockReset();
    this.callAction.mockImplementation(async (name: string) =>
      name === "request-role"
        ? { request: roleRequest("role-request-new", "me@example.test") }
        : {},
    );
    this.refetch.mockClear();
  },
};

export const roleRequestHooksMock = {
  callAction: (...args: unknown[]) => roleRequests.callAction(...args),
  useActionQuery: (name: string) =>
    name === "get-workspace-bootstrap"
      ? {
          data: { features: { isAdmin: roleRequests.isAdmin } },
          isPending: false,
          error: null,
          refetch: roleRequests.refetch,
        }
      : name === "list-workspace-user-groups"
        ? {
            data: [],
            isPending: false,
            error: null,
            refetch: roleRequests.refetch,
          }
        : {
            data: roleRequests.loading
              ? undefined
              : { requests: roleRequests.requests },
            isPending: roleRequests.loading,
            error: null,
            refetch: roleRequests.refetch,
          },
};
