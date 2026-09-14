import { ROLE_RANK, type ShareRole } from "@agent-native/core/sharing";

/**
 * One role decides both what `list-design-systems` reports as `canManage` and
 * what `delete-design-system` enforces. When those two drifted apart, the
 * Design Systems page rendered Delete for every shared admin and the action
 * answered "Requires owner role" — the affordance and the boundary must read
 * the same constant, not two copies of the same intent.
 */
export const DESIGN_SYSTEM_MANAGE_ROLE: ShareRole = "admin";

export function canManageDesignSystemRole(role: "owner" | ShareRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[DESIGN_SYSTEM_MANAGE_ROLE];
}
