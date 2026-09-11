import type { AppRolesDescriptor } from "@agent-native/core/client/org";

export const dispatchAccessDescriptor = {
  appId: "dispatch",
  roles: ["admin"] as const,
  roleLabels: { admin: "Dispatch admin" },
  label: "Dispatch access",
} satisfies AppRolesDescriptor<"admin">;
