import { getOrgSetting, mutateOrgSetting } from "@agent-native/core/settings";

import {
  roleRequestSchema,
  roleRequestStatusSchema,
  type RoleRequest,
} from "../../app/lib/model/role-request-contracts.js";

/**
 * Workspace role requests.
 *
 * The original lets a member ask to be raised to an admin and gives an admin a
 * queue to decide it (OrgRoleRequestConfigPanel + the role-request mutation).
 * This app's access requests in the platform are resource-scoped only, so a
 * member asking for a role has nowhere to file it; the workspace keeps its own
 * queue here, keyed to the organization, and an approval goes through the same
 * membership the rest of the app reads.
 */
const SETTING_KEY = "analytics.roleRequests";

export type { RoleRequest };

function parseList(stored: Record<string, unknown> | null): RoleRequest[] {
  const raw = stored?.requests;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = roleRequestSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function listRoleRequests(orgId: string): Promise<RoleRequest[]> {
  return parseList(await getOrgSetting(orgId, SETTING_KEY));
}

/** The caller's own open request, if they have one. */
export async function findPendingRequest(
  orgId: string,
  email: string,
): Promise<RoleRequest | null> {
  const wanted = email.toLowerCase();
  const requests = await listRoleRequests(orgId);
  return (
    requests.find(
      (request) =>
        request.status === "pending" &&
        request.requestedBy.toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * Files (or replaces) the caller's pending request. One pending request per
 * person: asking twice for the same role keeps the first request's id so an
 * admin's queue never fills with duplicates.
 */
export async function fileRoleRequest(
  orgId: string,
  email: string,
  requestedRole: RoleRequest["requestedRole"],
): Promise<RoleRequest> {
  const wanted = email.toLowerCase();
  let filed: RoleRequest | null = null;
  await mutateOrgSetting(orgId, SETTING_KEY, (current) => {
    const requests = parseList(current);
    const existing = requests.find(
      (request) =>
        request.status === "pending" &&
        request.requestedBy.toLowerCase() === wanted,
    );
    const now = new Date().toISOString();
    const next: RoleRequest = existing
      ? { ...existing, requestedRole, requestedAt: existing.requestedAt }
      : {
          id: `role-request-${now}-${Math.random().toString(36).slice(2, 8)}`,
          requestedBy: wanted,
          requestedRole,
          status: "pending",
          requestedAt: now,
          resolvedAt: null,
          resolvedBy: null,
        };
    filed = next;
    return {
      requests: existing
        ? requests.map((request) => (request === existing ? next : request))
        : [...requests, next],
    };
  });
  if (!filed) throw new Error("The role request was not recorded.");
  return filed;
}

export async function resolveRoleRequest(
  orgId: string,
  id: string,
  decision: Exclude<RoleRequest["status"], "pending">,
  resolvedBy: string,
): Promise<RoleRequest | null> {
  let resolved: RoleRequest | null = null;
  await mutateOrgSetting(orgId, SETTING_KEY, (current) => {
    const requests = parseList(current);
    const now = new Date().toISOString();
    return {
      requests: requests.map((request) => {
        if (request.id !== id || request.status !== "pending") return request;
        resolved = {
          ...request,
          status: roleRequestStatusSchema.parse(decision),
          resolvedAt: now,
          resolvedBy: resolvedBy.toLowerCase(),
        };
        return resolved;
      }),
    };
  });
  return resolved;
}
