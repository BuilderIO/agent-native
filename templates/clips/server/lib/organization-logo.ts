import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import {
  getAppProductionUrl,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";

import {
  ORGANIZATION_LOGO_PURPOSE,
  ORGANIZATION_LOGO_REFERENCE_PREFIX,
  organizationLogoRoutePath,
} from "../../shared/organization-logo.js";

export { ORGANIZATION_LOGO_PURPOSE, ORGANIZATION_LOGO_REFERENCE_PREFIX };

export function encodeOrganizationLogoReference(
  handle: PrivateBlobHandle,
): string {
  return `${ORGANIZATION_LOGO_REFERENCE_PREFIX}${Buffer.from(
    JSON.stringify(handle),
  ).toString("base64url")}`;
}

export function decodeOrganizationLogoReference(
  value: string,
  organizationId: string,
): PrivateBlobHandle | null {
  if (!value.startsWith(ORGANIZATION_LOGO_REFERENCE_PREFIX)) return null;
  if (value.length > 16_384) {
    throw new Error("Organization logo reference is invalid");
  }
  try {
    const handle = JSON.parse(
      Buffer.from(
        value.slice(ORGANIZATION_LOGO_REFERENCE_PREFIX.length),
        "base64url",
      ).toString("utf8"),
    ) as PrivateBlobHandle;
    if (
      !handle ||
      typeof handle.id !== "string" ||
      typeof handle.provider !== "string" ||
      handle.opaque !== true ||
      typeof handle.encrypted !== "boolean" ||
      handle.metadata?.purpose !== ORGANIZATION_LOGO_PURPOSE ||
      handle.metadata?.organizationId !== organizationId
    ) {
      throw new Error("Organization logo reference is invalid");
    }
    return handle;
  } catch {
    throw new Error("Organization logo reference is invalid");
  }
}

export function organizationLogoAbsoluteUrl(organizationId: string): string {
  return `${withConfiguredAppBasePath(getAppProductionUrl())}${organizationLogoRoutePath(organizationId)}`;
}
