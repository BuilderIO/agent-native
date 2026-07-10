import {
  ForbiddenError,
  resolveAccess,
  type AccessContext,
} from "../sharing/access.js";
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

function accessContextFrom(
  ctx?: VersionedResourceContext,
): AccessContext | undefined {
  if (!ctx) return undefined;
  return {
    userEmail: ctx.userEmail ?? undefined,
    orgId: ctx.orgId ?? undefined,
  };
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
    const access = await resolveAccess(
      resourceType,
      resourceId,
      accessContextFrom(ctx),
    );
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

  // Fail closed: unregistered types, and registered types without an access
  // resolver that aren't shareable, never invent ownership. bypassScope on
  // history queries is only safe after a real resource ACL.
  return null;
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
