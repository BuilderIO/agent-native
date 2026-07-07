import { ForbiddenError, resolveAccess } from "../sharing/access.js";
import { getShareableResource } from "../sharing/registry.js";
import { roleSatisfies, type Visibility } from "../sharing/schema.js";
import type {
  HistoryResourceRole,
  VersionedResourceAccess,
  VersionedResourceContext,
  VersionedResourceRegistration,
} from "./types.js";

const registrations = new Map<string, VersionedResourceRegistration>();

export function registerVersionedResource(
  registration: VersionedResourceRegistration,
): void {
  if (!registration.type.trim()) {
    throw new Error(
      "registerVersionedResource requires a non-empty resource type",
    );
  }
  registrations.set(registration.type, registration);
}

export function getVersionedResource(
  type: string,
): VersionedResourceRegistration | undefined {
  return registrations.get(type);
}

export function listVersionedResources(): VersionedResourceRegistration[] {
  return Array.from(registrations.values());
}

export async function resolveVersionedResourceAccess(
  resourceType: string,
  resourceId: string,
  ctx?: VersionedResourceContext,
): Promise<VersionedResourceAccess | null> {
  const registration = getVersionedResource(resourceType);
  if (registration?.resolveAccess) {
    return registration.resolveAccess(resourceId, ctx);
  }

  if (getShareableResource(resourceType)) {
    const access = await resolveAccess(resourceType, resourceId);
    if (!access) {
      return null;
    }
    return {
      role: access.role as HistoryResourceRole,
      ownerEmail: access.resource.ownerEmail ?? null,
      orgId: access.resource.orgId ?? null,
      visibility: access.resource.visibility,
      resource: access.resource,
    };
  }

  const userEmail = ctx?.userEmail ?? null;
  if (!userEmail) {
    return null;
  }
  return {
    role: "owner",
    ownerEmail: userEmail,
    orgId: ctx?.orgId ?? null,
    visibility: "private",
  };
}

export async function assertVersionedResourceAccess(
  resourceType: string,
  resourceId: string,
  ctx: VersionedResourceContext | undefined,
  minimumRole: HistoryResourceRole,
): Promise<VersionedResourceAccess> {
  const access = await resolveVersionedResourceAccess(
    resourceType,
    resourceId,
    ctx,
  );
  if (!access || !roleSatisfies(access.role, minimumRole)) {
    throw new ForbiddenError(
      `Not allowed to access ${resourceType}:${resourceId}`,
    );
  }
  return access;
}

export function normalizeHistoryVisibility(
  visibility: Visibility | null | undefined,
): Visibility {
  return visibility === "org" || visibility === "public"
    ? visibility
    : "private";
}

export function __resetVersionedResourcesForTests(): void {
  registrations.clear();
}
