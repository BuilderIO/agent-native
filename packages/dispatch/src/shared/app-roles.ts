import type { AppRolesDescriptor } from "@agent-native/core/org/app-roles";

export const dispatchAccessDescriptor = {
  appId: "dispatch",
  roles: ["admin"] as const,
  permissions: { administer: ["admin"] as const },
  roleLabels: { admin: "Dispatch admin" },
  label: "Dispatch access",
} satisfies AppRolesDescriptor<"admin">;
