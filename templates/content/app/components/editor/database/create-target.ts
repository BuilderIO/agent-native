import type { ContentDatabaseResponse } from "../../../../shared/api.js";

export type DatabaseCreateTarget =
  | { kind: "row" }
  | { kind: "space-page"; spaceId: string }
  | {
      kind: "unsupported";
      reason: "loading" | "catalog" | "read-only" | "github";
    };

function isGitHubSourceType(sourceType: string | undefined) {
  return sourceType === "github" || sourceType === "github-pull-requests";
}

export function databaseCreateTarget(
  data:
    | Pick<
        ContentDatabaseResponse,
        "database" | "mutationContract" | "source" | "sources"
      >
    | undefined,
): DatabaseCreateTarget {
  if (!data) return { kind: "unsupported", reason: "loading" };
  const systemRole = data.database.systemRole ?? null;
  if (systemRole === "workspaces") {
    return { kind: "unsupported", reason: "catalog" };
  }
  if (systemRole === "files") {
    const spaceId = data.database.spaceId;
    return spaceId
      ? { kind: "space-page", spaceId }
      : { kind: "unsupported", reason: "read-only" };
  }
  if (!data.mutationContract) {
    return { kind: "unsupported", reason: "read-only" };
  }
  // Rows in a collection linked to GitHub come from its files or pull
  // requests.
  if (
    isGitHubSourceType(data.source?.sourceType) ||
    data.sources?.some((source) => isGitHubSourceType(source.sourceType))
  ) {
    return { kind: "unsupported", reason: "github" };
  }
  return { kind: "row" };
}

export function databaseCanCreateItems(target: DatabaseCreateTarget) {
  return target.kind !== "unsupported";
}
