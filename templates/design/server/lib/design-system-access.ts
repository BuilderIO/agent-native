import { ROLE_RANK, type ShareRole } from "@agent-native/core/sharing";

export const DESIGN_SYSTEM_MANAGE_ROLE: ShareRole = "admin";

export function canManageDesignSystemRole(role: "owner" | ShareRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[DESIGN_SYSTEM_MANAGE_ROLE];
}
