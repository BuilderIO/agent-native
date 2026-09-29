import { useAppPermissions } from "@agent-native/core/client/org";
import type { ReactNode } from "react";

export function RequirePermission({
  appId,
  permission,
  children,
  fallback = null,
}: {
  appId: string | undefined;
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const access = useAppPermissions(appId);
  return access.can(permission) ? children : fallback;
}
