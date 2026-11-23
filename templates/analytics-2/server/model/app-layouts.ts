import { and, eq } from "@agent-native/core/db/schema";

import { notebookMessages } from "../../app/i18n/messages/notebook.js";
import {
  appDocumentSchema,
  type AppDocument,
} from "../../shared/app-layout.js";
import { schema } from "../db/index.js";
import { StoredDataError } from "./json-column.js";
import type { Queryable } from "./scope.js";

const { appLayouts } = schema;

export async function readAppDocument(
  tx: Queryable,
  orgId: string,
  projectId: string,
  versionId: string,
) {
  const [row] = await tx
    .select({
      document: appLayouts.document,
      revision: appLayouts.layoutRevision,
    })
    .from(appLayouts)
    .where(
      and(
        eq(appLayouts.orgId, orgId),
        eq(appLayouts.projectId, projectId),
        eq(appLayouts.workingVersionId, versionId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const document = appDocumentSchema.safeParse(row.document);
  if (!document.success || document.data.revision !== row.revision.toString())
    throw new StoredDataError(notebookMessages.notebook.savedContentFailed);
  return document.data;
}

export async function writeAppDocument(
  tx: Queryable,
  orgId: string,
  projectId: string,
  workingVersionId: string,
  document: AppDocument,
) {
  const content = { document, layoutRevision: BigInt(document.revision) };
  await tx
    .insert(appLayouts)
    .values({ orgId, projectId, workingVersionId, ...content })
    .onConflictDoUpdate({
      target: [
        appLayouts.orgId,
        appLayouts.projectId,
        appLayouts.workingVersionId,
      ],
      set: content,
    });
}
