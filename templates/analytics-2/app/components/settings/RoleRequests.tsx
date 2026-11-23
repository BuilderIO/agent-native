import { AppSettingsSections } from "@/skins/app-settings-sections";

import {
  useRoleRequestControlSections,
  useRoleRequestQueueSections,
} from "./useRoleRequestsSections";

/**
 * Ask an administrator for an admin role.
 *
 * The reference lets a member request a role and gives an administrator a queue
 * to decide it; the platform's access requests are resource-scoped, so the
 * workspace keeps this queue itself (server/model/role-requests-store.ts).
 * A member sees this row on their own profile and an administrator sees the
 * decision queue on Settings → Users.
 */
export function RoleRequestControl() {
  return (
    <AppSettingsSections
      sections={useRoleRequestControlSections()}
      hints={{ frame: "stack" }}
    />
  );
}

/** The administrator's queue: approve raises the member to admin, decline closes it. */
export function RoleRequestQueue() {
  return (
    <AppSettingsSections
      sections={useRoleRequestQueueSections()}
      hints={{ frame: "stack" }}
    />
  );
}
