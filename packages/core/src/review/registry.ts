import type { DbExec } from "../db/client.js";
import {
  ForbiddenError,
  resolveAccess,
  type AccessContext,
} from "../sharing/access.js";
import { getShareableResource } from "../sharing/registry.js";
import { roleSatisfies, type Visibility } from "../sharing/schema.js";
import { ReviewAnchorError } from "./errors.js";
import type {
  ReviewAnchorKind,
  ReviewCommentPolicy,
  ReviewCommentWriteEvent,
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
  for (const [name, kind] of Object.entries(registration.anchorKinds ?? {})) {
    if (!name.trim() || !Number.isInteger(kind.version) || kind.version < 1) {
      throw new Error(
        `Anchor kind "${name}" on ${registration.type} needs a name and a whole version from 1`,
      );
    }
    if (ownAnchorKind(KIT_ANCHOR_KINDS, name)) {
      throw new Error(`Anchor kind "${name}" belongs to the review kit`);
    }
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
    transaction: ctx.transaction as AccessContext["transaction"],
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

/** The resource's comment policy, with the kit's defaults filled in. */
export function reviewCommentPolicy(
  resourceType: string,
): Required<ReviewCommentPolicy> {
  const policy = getReviewableResource(resourceType)?.comments;
  return {
    minimumRole: policy?.minimumRole ?? "commenter",
    unmentionedRoute: policy?.unmentionedRoute ?? "agent",
  };
}

/**
 * Whether this access lets its holder comment, reply and react, and edit or
 * delete their own comments.
 */
export function canCommentOnReviewableResource(
  resourceType: string,
  access: ReviewResourceAccess | null | undefined,
): access is ReviewResourceAccess {
  return Boolean(
    access &&
    roleSatisfies(access.role, reviewCommentPolicy(resourceType).minimumRole),
  );
}

/** Checks the caller holds at least the role the comment policy asks for. */
export async function assertReviewCommentAccess(
  resourceType: string,
  resourceId: string,
  ctx: ReviewResourceContext | undefined,
): Promise<ReviewResourceAccess> {
  const access = await resolveReviewableResourceAccess(
    resourceType,
    resourceId,
    ctx,
  );
  if (!canCommentOnReviewableResource(resourceType, access)) {
    throw new ForbiddenError(
      `Not allowed to comment on ${resourceType}:${resourceId}`,
    );
  }
  return access;
}

/**
 * The kit's own anchor kind, on the thread a suggestion opens: the anchors of
 * its operations, in order. Every resource accepts it, and none may declare it.
 */
export const REVIEW_SUGGESTION_ANCHOR_KIND = "review-suggestion";

const KIT_ANCHOR_KINDS: Readonly<Record<string, ReviewAnchorKind>> = {
  [REVIEW_SUGGESTION_ANCHOR_KIND]: { version: 1, parse: (anchor) => anchor },
};

function ownAnchorKind(
  kinds: Readonly<Record<string, ReviewAnchorKind>> | undefined,
  name: string,
): ReviewAnchorKind | null {
  const kind = kinds?.[name];
  return kind && Object.prototype.hasOwnProperty.call(kinds, name)
    ? kind
    : null;
}

export interface ReviewAnchorInput {
  anchor?: unknown;
  anchorKind?: string | null;
  anchorVersion?: number | null;
}

export interface NormalizedReviewAnchor {
  anchor: unknown;
  anchorKind: string | null;
  anchorVersion: number | null;
}

/**
 * Checks a comment's anchor against its resource's anchor kinds and returns it
 * as it's stored. A resource that declares no kinds keeps untyped anchors, as
 * before kinds existed; one that declares any needs every anchor to name one.
 */
export function normalizeReviewAnchor(
  resourceType: string,
  input: ReviewAnchorInput,
): NormalizedReviewAnchor {
  const anchor = input.anchor ?? null;
  const kinds = getReviewableResource(resourceType)?.anchorKinds;
  const kindName = input.anchorKind ?? null;
  if (kindName === null) {
    if (input.anchorVersion != null) {
      throw new ReviewAnchorError("An anchor version needs an anchor kind.");
    }
    if (anchor !== null && kinds && Object.keys(kinds).length > 0) {
      throw new ReviewAnchorError(
        `Anchored ${resourceType} comments need an anchor kind: ${Object.keys(kinds).join(", ")}.`,
      );
    }
    return { anchor, anchorKind: null, anchorVersion: null };
  }
  const kind =
    ownAnchorKind(KIT_ANCHOR_KINDS, kindName) ?? ownAnchorKind(kinds, kindName);
  if (!kind) {
    throw new ReviewAnchorError(
      `${resourceType} comments have no anchor kind "${kindName}".`,
    );
  }
  const version = input.anchorVersion ?? kind.version;
  if (!Number.isInteger(version) || version < 1 || version > kind.version) {
    throw new ReviewAnchorError(
      `Anchor kind "${kindName}" has no version ${version}; the latest is ${kind.version}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = kind.parse(anchor, version);
  } catch (error) {
    throw new ReviewAnchorError(
      `Not a valid "${kindName}" anchor: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    anchor: parsed === undefined ? null : parsed,
    anchorKind: kindName,
    anchorVersion: version,
  };
}

/** Whether a resource type has a hook that comment writes must run. */
export function hasReviewCommentWriteHook(resourceType: string): boolean {
  return Boolean(getReviewableResource(resourceType)?.onCommentWrite);
}

/** Runs the resource's comment write hook on the write's own transaction. */
export async function runReviewCommentWriteHook(
  resourceType: string,
  event: ReviewCommentWriteEvent,
  tx: DbExec,
): Promise<void> {
  await getReviewableResource(resourceType)?.onCommentWrite?.(event, tx);
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
