import type { ContentDatabaseSource } from "@shared/api";
import { GITHUB_SOURCE_TYPE, githubFolderName } from "@shared/github-source";

import { githubRelativeTime } from "./github-source-text";
import { dbText } from "./text";

/** The collection the Sources panel is about, as GitHub linking needs it. */
export interface GitHubCollectionPlace {
  databaseId: string;
  documentId: string;
  /** Where a new collection beside this one goes. */
  spaceId?: string;
  parentId: string | null;
  systemRole: string | null;
  pageCount: number;
  canEdit: boolean;
}

export type GitHubBlockedReason =
  | "files"
  | "system"
  | "editors-only"
  | "other-source"
  | "has-pages";

/** Whether this collection can take a GitHub folder, and if not, why. */
export type GitHubAvailability =
  | { kind: "linked"; source: ContentDatabaseSource }
  | { kind: "available" }
  | { kind: "connect" }
  | {
      kind: "blocked";
      reason: GitHubBlockedReason;
      /** The other app the collection's pages come from. */
      sourceName?: string;
    };

/** The app a source's pages come from, as people call it. */
export function sourceAppName(source: ContentDatabaseSource): string {
  if (source.sourceType === "builder-cms") return "Builder";
  if (source.sourceType === "notion-database") return "Notion";
  return source.sourceName;
}

/**
 * Checks the collection before the GitHub connection, so nobody is sent
 * through GitHub's sign-in for a collection that could never link. The server
 * checks again when linking, for changes made in between.
 */
export function githubAvailability(
  place: GitHubCollectionPlace,
  sources: ContentDatabaseSource[],
  connected: boolean | null | undefined,
): GitHubAvailability {
  const linked = sources.find(
    (source) => source.sourceType === GITHUB_SOURCE_TYPE,
  );
  if (linked) return { kind: "linked", source: linked };
  if (place.systemRole === "files") return { kind: "blocked", reason: "files" };
  if (place.systemRole) return { kind: "blocked", reason: "system" };
  if (!place.canEdit) return { kind: "blocked", reason: "editors-only" };
  const other = sources[0];
  if (other) {
    return {
      kind: "blocked",
      reason: "other-source",
      sourceName: sourceAppName(other),
    };
  }
  if (place.pageCount > 0) return { kind: "blocked", reason: "has-pages" };
  // An unknown connection is left to the dialog, which asks again.
  return connected === false ? { kind: "connect" } : { kind: "available" };
}

/** Whether a blocked collection can point to a new one instead. */
export function githubOffersNewCollection(
  availability: GitHubAvailability,
  place: GitHubCollectionPlace,
): boolean {
  return (
    availability.kind === "blocked" &&
    availability.reason !== "editors-only" &&
    !!place.spaceId
  );
}

/** The line under "GitHub" in Sources, always visible. */
export function githubRowDescription(
  availability: GitHubAvailability,
  now = Date.now(),
): string {
  switch (availability.kind) {
    case "linked": {
      const status = availability.source.metadata.github;
      const folder = status
        ? githubFolderName(status)
        : availability.source.sourceName;
      return status?.syncedAt
        ? dbText("githubRowLinked", {
            folder,
            time: githubRelativeTime(status.syncedAt, now),
          })
        : dbText("githubRowLinkedNotUpdated", { folder });
    }
    case "available":
      return dbText("githubRowAvailable");
    case "connect":
      return dbText("githubRowConnectFirst");
    case "blocked":
      switch (availability.reason) {
        case "files":
          return dbText("githubRowFiles");
        case "system":
          return dbText("githubRowSystem");
        case "editors-only":
          return dbText("githubRowEditorsOnly");
        case "other-source":
          return dbText("githubRowOtherSource", {
            source: availability.sourceName ?? "",
          });
        case "has-pages":
          return dbText("githubRowEmptyOnly");
      }
  }
}

/** The full reason a blocked collection can't take a folder. */
export function githubBlockedExplanation(
  reason: GitHubBlockedReason,
  place: GitHubCollectionPlace,
  sourceName?: string,
): string {
  switch (reason) {
    case "files":
      return dbText("githubExplainFiles");
    case "system":
      return dbText("githubExplainSystem");
    case "editors-only":
      return dbText("githubExplainEditorsOnly");
    case "other-source":
      return dbText("githubExplainOtherSource", { source: sourceName ?? "" });
    case "has-pages":
      return place.pageCount === 1
        ? dbText("githubExplainHasPagesOne")
        : dbText("githubExplainHasPages", { count: place.pageCount });
  }
}
