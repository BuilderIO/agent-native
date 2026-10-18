import { ActionContractError } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { DocumentSourceInfo } from "../shared/api.js";
import {
  githubFileWebUrl,
  parseGitHubSourceTable,
} from "../shared/github-source.js";

interface DocumentSourceColumns {
  sourceMode?: string | null;
  sourceKind?: string | null;
  sourcePath?: string | null;
  sourceAbsolutePath?: string | null;
  sourceRootPath?: string | null;
  sourceUpdatedAt?: string | null;
}

export function serializeDocumentSource(
  document: DocumentSourceColumns,
): DocumentSourceInfo | undefined {
  if (
    document.sourceMode !== "database" &&
    document.sourceMode !== "local-files" &&
    document.sourceMode !== "github"
  ) {
    return undefined;
  }

  const githubFolder =
    document.sourceMode === "github"
      ? parseGitHubSourceTable(document.sourceRootPath)
      : null;
  return {
    mode: document.sourceMode,
    kind: document.sourceKind ?? undefined,
    path: document.sourcePath ?? undefined,
    absolutePath: document.sourceAbsolutePath ?? undefined,
    rootPath: document.sourceRootPath ?? undefined,
    updatedAt: document.sourceUpdatedAt ?? undefined,
    ...(githubFolder && document.sourcePath
      ? { url: githubFileWebUrl(githubFolder, document.sourcePath) }
      : {}),
  };
}

/**
 * Pages that follow a GitHub file are written by sync only: their title,
 * body and description are edited in GitHub. Comments, Content-only columns
 * and the page icon stay editable.
 */
export function assertSourceAllowsPageEdit(document: DocumentSourceColumns) {
  if (document.sourceMode !== "github") return;
  const folder = parseGitHubSourceTable(document.sourceRootPath);
  const file =
    folder && document.sourcePath
      ? ` at ${githubFileWebUrl(folder, document.sourcePath)}`
      : " in GitHub";
  throw new ActionContractError(
    `This page follows a file in GitHub and is view only here. Edit the file${file}; Content updates after each push.`,
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A GitHub folder decides its collection's rows and columns, so the general
 * source settings (another source, roles, column bindings) don't apply.
 */
export function assertNotGitHubSource(
  source: { sourceType: string } | null | undefined,
) {
  if (source?.sourceType !== "github") return;
  throw new ActionContractError(
    "This collection follows a GitHub folder, which decides its rows and columns, so its source settings can't change here.",
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}

/**
 * A collection linked to a GitHub folder gets its rows from the folder's
 * files, so Content doesn't add rows of its own to it.
 */
export async function assertCollectionAcceptsNewRows(
  databaseId: string,
  db: ReturnType<typeof getDb> = getDb(),
) {
  const [linked] = await db
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.sourceType, "github"),
      ),
    )
    .limit(1);
  if (!linked) return;
  throw new ActionContractError(
    "This collection follows a GitHub folder, so its rows come from the files there. Add a Markdown file in GitHub; Content adds the row after the next push.",
    { errorCode: "SOURCE_READ_ONLY", statusCode: 409 },
  );
}
