export type ResourceRole = "owner" | "admin" | "editor" | "viewer";

export interface ResourceAccess {
  role?: ResourceRole | null;
  canEdit?: boolean | null;
  canManage?: boolean | null;
}

const EDIT_ROLES = new Set<ResourceRole>(["owner", "admin", "editor"]);
const MANAGE_ROLES = new Set<ResourceRole>(["owner", "admin"]);

export function resourceCanEdit(
  access: ResourceAccess | null | undefined,
  fallback = true,
): boolean {
  if (typeof access?.canEdit === "boolean") return access.canEdit;
  if (access?.role) return EDIT_ROLES.has(access.role);
  return fallback;
}

export function resourceCanManage(
  access: ResourceAccess | null | undefined,
  fallback = true,
): boolean {
  if (typeof access?.canManage === "boolean") return access.canManage;
  if (access?.role) return MANAGE_ROLES.has(access.role);
  return fallback;
}
