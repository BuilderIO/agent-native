import { ActionContractError } from "@agent-native/core/action";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";
import { provisionContentSpaces } from "./_content-spaces.js";

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

export async function resolveContentSpaceTarget(args: {
  db: any;
  userEmail: string;
  spaceId?: string | null;
  spaceName?: string | null;
  requiredRole?: "viewer" | "contributor" | "editor";
}): Promise<ContentSpaceTargetResolution> {
  const requiredRole = args.requiredRole ?? "contributor";
  const spaceName = args.spaceName?.trim() || null;
  if (args.spaceId && spaceName) {
    throw new ActionContractError(
      "Pass either spaceId or spaceName, not both.",
      { errorCode: "SPACE_TARGET_CONFLICT", statusCode: 400 },
    );
  }
  const provisioned = await provisionContentSpaces(args.db, args.userEmail);
  if (args.spaceId) {
    await resolveContentSpaceAccess(args.spaceId, requiredRole, {
      db: args.db,
    });
    return { spaceId: args.spaceId, matchedBy: "id" };
  }
  if (spaceName) {
    const candidates = await listAuthorizedContentSpaces(
      args.db,
      args.userEmail,
    );
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
  await resolveContentSpaceAccess(provisioned.personalSpaceId, requiredRole, {
    db: args.db,
  });
  return { spaceId: provisioned.personalSpaceId, matchedBy: "default" };
}
