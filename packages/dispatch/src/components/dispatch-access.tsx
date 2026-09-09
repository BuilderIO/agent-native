import { canManageOrg, useOrgRole } from "@agent-native/core/client/org";
import { DefaultSpinner } from "@agent-native/core/client/ui";
import { type ReactNode } from "react";

export function RequireDispatchAccess({ children }: { children: ReactNode }) {
  const { org, role, isLoading, error } = useOrgRole();

  if (isLoading) return <DefaultSpinner />;
  if (error) return null;
  if (org?.orgId && !canManageOrg(role)) return null;

  return <>{children}</>;
}
