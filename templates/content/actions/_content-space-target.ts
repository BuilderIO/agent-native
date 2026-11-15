import { ActionContractError } from "@agent-native/core/action";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { type getDb, schema } from "../server/db/index.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";
import {
  organizationContentSpaceId,
  personalContentSpaceId,
  provisionContentSpaces,
} from "./_content-spaces.js";

export type ContentSpaceNameCandidate = { id: string; name: string };

export type ContentSpaceTargetResolution = {
  spaceId: string;
  matchedBy: "id" | "name" | "default";
};

function compare(value: string) {
  return value.trim().toLowerCase();
}

export function matchContentSpaceByName(
  candidates: ContentSpaceNameCandidate[],
  name: string,
):
  | { status: "matched"; spaceId: string }
  | { status: "not_found" }
  | { status: "ambiguous"; spaceIds: string[] } {
  const wanted = compare(name);
  const matches = candidates.filter(
    (candidate) => compare(candidate.name) === wanted,
  );
  if (matches.length === 1)
    return { status: "matched", spaceId: matches[0].id };
  if (matches.length === 0) return { status: "not_found" };
  return { status: "ambiguous", spaceIds: matches.map((match) => match.id) };
}

export async function listAuthorizedContentSpaces(
  db: any,
  userEmail: string,
): Promise<ContentSpaceNameCandidate[]> {
  const email = normalizeContentSpaceEmail(userEmail);
  const orgIds = (await listContentOrganizationMemberships(email)).map(
    (membership) => membership.orgId,
  );
  const rows = await db
    .select({ id: schema.contentSpaces.id, name: schema.contentSpaces.name })
    .from(schema.contentSpaces)
    .where(
      and(
        isNull(schema.contentSpaces.archivedAt),
        orgIds.length > 0
          ? or(
              eq(schema.contentSpaces.ownerEmail, email),
              inArray(schema.contentSpaces.orgId, orgIds),
            )
          : eq(schema.contentSpaces.ownerEmail, email),
      ),
    );
  return rows as ContentSpaceNameCandidate[];
}

/**
 * The caller's workspaces the setup pass would create, named as it names them:
 * their Personal workspace and one per organization, each only while it has no
 * row. A workspace with a row, even an archived one, is left as it is.
 */
async function contentSpacesSetupWouldCreate(
  db: ReturnType<typeof getDb>,
  userEmail: string,
): Promise<ContentSpaceNameCandidate[]> {
  const email = normalizeContentSpaceEmail(userEmail);
  const memberships = await listContentOrganizationMemberships(email);
  const spaces = [
    { id: personalContentSpaceId(email), name: "Personal" },
    ...memberships.map((membership) => ({
      id: organizationContentSpaceId(membership.orgId),
      name: membership.name,
    })),
  ];
  const rows: { id: string }[] = await db
    .select({ id: schema.contentSpaces.id })
    .from(schema.contentSpaces)
    .where(
      inArray(
        schema.contentSpaces.id,
        spaces.map((space) => space.id),
      ),
    );
  const existing = new Set(rows.map((row) => row.id));
  return spaces.filter((space) => !existing.has(space.id));
}

/**
 * Checks the caller's access to a workspace, and creates the caller's
 * workspaces first only when it is one of theirs that doesn't exist yet. That
 * pass checks every workspace the caller belongs to, which takes more than a
 * hundred queries for a member of a few organizations. The app runs it once
 * when it loads, so a workspace the caller can already see doesn't need it
 * again on each create, and one the pass wouldn't create never does.
 */
export async function resolveProvisionedContentSpaceAccess(args: {
  db: ReturnType<typeof getDb>;
  userEmail: string;
  spaceId: string;
  requiredRole: "viewer" | "contributor" | "editor";
  /** false only checks access, for previews. */
  provision?: boolean;
}) {
  try {
    return await resolveContentSpaceAccess(args.spaceId, args.requiredRole, {
      db: args.db,
    });
  } catch (error) {
    if (
      args.provision === false ||
      !(error instanceof ActionContractError) ||
      error.errorCode !== "SPACE_NOT_FOUND" ||
      !(await contentSpacesSetupWouldCreate(args.db, args.userEmail)).some(
        (space) => space.id === args.spaceId,
      )
    ) {
      throw error;
    }
  }
  await provisionContentSpaces(args.db, args.userEmail);
  return resolveContentSpaceAccess(args.spaceId, args.requiredRole, {
    db: args.db,
  });
}

export async function resolveContentSpaceTarget(args: {
  db: any;
  userEmail: string;
  spaceId?: string | null;
  spaceName?: string | null;
  requiredRole?: "viewer" | "contributor" | "editor";
  /** false resolves without creating the caller's workspaces, for previews. */
  provision?: boolean;
}): Promise<ContentSpaceTargetResolution> {
  const requiredRole = args.requiredRole ?? "contributor";
  const spaceName = args.spaceName?.trim() || null;
  if (args.spaceId && spaceName) {
    throw new ActionContractError(
      "Pass either spaceId or spaceName, not both.",
      { errorCode: "SPACE_TARGET_CONFLICT", statusCode: 400 },
    );
  }
  if (args.spaceId) {
    await resolveProvisionedContentSpaceAccess({
      ...args,
      spaceId: args.spaceId,
      requiredRole,
    });
    return { spaceId: args.spaceId, matchedBy: "id" };
  }
  if (spaceName) {
    let candidates = await listAuthorizedContentSpaces(args.db, args.userEmail);
    // An organization the caller just joined has no workspace until it is
    // created, so a name the setup pass would give a new one runs it first,
    // even when an existing workspace has that name too.
    if (args.provision !== false) {
      const missing = await contentSpacesSetupWouldCreate(
        args.db,
        args.userEmail,
      );
      if (matchContentSpaceByName(missing, spaceName).status !== "not_found") {
        await provisionContentSpaces(args.db, args.userEmail);
        candidates = await listAuthorizedContentSpaces(args.db, args.userEmail);
      }
    }
    const match = matchContentSpaceByName(candidates, spaceName);
    if (match.status !== "matched") {
      const available = candidates
        .map((candidate) => candidate.name)
        .sort()
        .join(", ");
      throw new ActionContractError(
        match.status === "ambiguous"
          ? `Several Content workspaces are named "${spaceName}". Pass spaceId instead. Available workspaces: ${available}.`
          : `No Content workspace named "${spaceName}". Available workspaces: ${available}.`,
        {
          errorCode:
            match.status === "ambiguous"
              ? "SPACE_NAME_AMBIGUOUS"
              : "SPACE_NAME_NOT_FOUND",
          statusCode: match.status === "ambiguous" ? 409 : 404,
        },
      );
    }
    await resolveContentSpaceAccess(match.spaceId, requiredRole, {
      db: args.db,
    });
    return { spaceId: match.spaceId, matchedBy: "name" };
  }
  // An unprovisioned Personal workspace has no row to check yet, but its id
  // derives from the caller's own email.
  const personalSpaceId = personalContentSpaceId(args.userEmail);
  if (args.provision !== false) {
    await resolveProvisionedContentSpaceAccess({
      ...args,
      spaceId: personalSpaceId,
      requiredRole,
    });
  }
  return { spaceId: personalSpaceId, matchedBy: "default" };
}
