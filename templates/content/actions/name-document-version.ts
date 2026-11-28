import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  nameCurrentDocumentVersion,
  normalizeDocumentVersionName,
  setDocumentCheckpointName,
} from "../server/lib/document-version-names.js";
import {
  DOCUMENT_VERSION_NAME_MAX_LENGTH,
  type NamedDocumentVersionResult,
} from "../shared/document-history.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";
import { namedDocumentVersionOutput } from "./_document-version-schemas.js";

function documentNotFound(documentId: string): never {
  fail(`Document "${documentId}" not found`, {
    errorCode: "DOCUMENT_NOT_FOUND",
    statusCode: 404,
  });
}

export default defineAction({
  description:
    'Name a version of a page in its Version history, such as "Week of Nov 17", so people and agents can find it, read it and compare it later. Omit versionId to save the page as it is now as a named version; open editors save first. Pass versionId (from list-document-versions) to name, rename or, with an empty name, unname that saved version. Names are unique on a page, ignoring case. Naming never changes the page. Requires edit access.',
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    versionId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Saved version to name. Omit it to name the page as it is now.",
      ),
    name: z
      .string()
      .max(DOCUMENT_VERSION_NAME_MAX_LENGTH)
      .describe(
        "The version's name. An empty string removes the name of versionId.",
      ),
  }),
  outputSchema: namedDocumentVersionOutput,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  searchHints: [
    "name this version",
    "label a version",
    "bookmark this version",
    "save a named version",
    "rename version",
  ],
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args, ctx): Promise<NamedDocumentVersionResult> => {
    const access = await assertAccess("document", args.documentId, "editor");
    if (access.resource.trashedAt) documentNotFound(args.documentId);
    const ownerEmail = access.resource.ownerEmail as string;
    const name = normalizeDocumentVersionName(args.name) || null;
    const now = new Date().toISOString();
    if (args.versionId) {
      return setDocumentCheckpointName({
        ownerEmail,
        documentId: args.documentId,
        versionId: args.versionId,
        name,
        namedBy: ctx?.userEmail ?? null,
        now,
      });
    }
    if (!name) {
      fail("Give the version a name, or pass versionId to remove one.", {
        errorCode: "DOCUMENT_VERSION_NAME_REQUIRED",
        statusCode: 400,
      });
    }
    const editorFlush = await flushOpenDocumentEditorToSql({
      documentId: args.documentId,
      ownerEmail,
    });
    const fresh = await assertAccess("document", args.documentId, "editor");
    if (fresh.resource.trashedAt) documentNotFound(args.documentId);
    const snapshot =
      editorFlush.status === "flushed" ? editorFlush.snapshot : undefined;
    const doc = snapshot ? { ...fresh.resource, ...snapshot } : fresh.resource;
    return nameCurrentDocumentVersion({
      ownerEmail: fresh.resource.ownerEmail as string,
      documentId: args.documentId,
      current: {
        title: doc.title as string,
        content: doc.content as string,
        bodyRevision: doc.bodyRevision as number | null,
      },
      name,
      ...(ctx ? { ctx } : {}),
      now,
    });
  },
});
