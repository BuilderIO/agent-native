import {
  ForbiddenError,
  resolveAccess,
  type AccessContext,
} from "../sharing/access.js";
import { getShareableResource } from "../sharing/registry.js";
import { roleSatisfies, type Visibility } from "../sharing/schema.js";
import type {
  ReviewResourceAccess,
  ReviewResourceContext,
  ReviewResourceRole,
  ReviewableResourceRegistration,
} from "./types.js";

const registrations = new Map<string, ReviewableResourceRegistration>();

export function registerReviewableResource(
  registration: ReviewableResourceRegistration,
): void {
  if (!registration.type.trim()) {
    throw new Error(
      "registerReviewableResource requires a non-empty resource type",
    );
  }
  registrations.set(registration.type, registration);
}

export function getReviewableResource(
  type: string,
): ReviewableResourceRegistration | undefined {
  return registrations.get(type);
}

export function listReviewableResources(): ReviewableResourceRegistration[] {
  return Array.from(registrations.values());
}

function accessContextFrom(
  ctx?: ReviewResourceContext,
): AccessContext | undefined {
  if (!ctx) return undefined;
  return {
    userEmail: ctx.userEmail ?? undefined,
    orgId: ctx.orgId ?? undefined,
  };
}

export async function resolveReviewableResourceAccess(
  resourceType: string,
  resourceId: string,
  ctx?: ReviewResourceContext,
): Promise<ReviewResourceAccess | null> {
  const registration = getReviewableResource(resourceType);
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
      role: access.role as ReviewResourceRole,
      ownerEmail: access.resource.ownerEmail ?? null,
      orgId: access.resource.orgId ?? null,
      visibility: access.resource.visibility,
      resource: access.resource,
    };
  }

  // Fail closed: unregistered types, and registered types without an access
  // resolver that aren't shareable, never invent ownership. bypassScope on
  // review queries is only safe after a real resource ACL.
  return null;
}

export async function assertReviewableResourceAccess(
  resourceType: string,
  resourceId: string,
  ctx: ReviewResourceContext | undefined,
  minimumRole: ReviewResourceRole,
): Promise<ReviewResourceAccess> {
  const access = await resolveReviewableResourceAccess(
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

export function normalizeReviewVisibility(
  visibility: Visibility | null | undefined,
): Visibility {
  return visibility === "org" || visibility === "public"
    ? visibility
    : "private";
}

export function __resetReviewableResourcesForTests(): void {
  registrations.clear();
}
