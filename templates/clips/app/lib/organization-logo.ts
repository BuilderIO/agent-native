import { appApiPath } from "@agent-native/core/client/api-path";

import {
  organizationLogoRoutePath,
  usesOrganizationLogoRoute,
} from "../../shared/organization-logo.js";

export function organizationLogoUrl(
  value: string | null | undefined,
  organizationId: string,
): string | null {
  const stored = value?.trim();
  if (!stored) return null;
  return usesOrganizationLogoRoute(stored)
    ? appApiPath(organizationLogoRoutePath(organizationId))
    : stored;
}
