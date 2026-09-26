import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";


function formatDocumentContent(markdown: string, format: "markdown" | "text") {
  return format === "text"
    ? markdown
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/[*_`~>]/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim()
    : markdown;
}

export default defineAction({
  description:
    "Read a document's final content, flushing any open live collaborative editing session to SQL first so external agents ingest exactly what the user sees (prefer this over get-document for external ingest).",
  schema: z.object({
    id: z.string().describe("Document ID (required)"),
    format: z
      .enum(["markdown", "text"])
      .default("markdown")
      .describe("Return format. 'markdown' (default) or plain 'text'."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id, format }) => {
    const access = await resolveAccess("document", id);
    if (
      !access ||
      access.resource.trashedAt ||
      (await isSoftDeletedDatabaseDocument(id))
    ) {
      throw new Error(`Document "${id}" not found`);
    }

    await flushOpenDocumentEditorToSql({
      documentId: id,
      ownerEmail: (access.resource.ownerEmail as string | undefined) || null,
    });

    const fresh = await resolveAccess("document", id);
    if (
      !fresh ||
      fresh.resource.trashedAt ||
      (await isSoftDeletedDatabaseDocument(id))
    ) {
      throw new Error(`Document "${id}" not found`);
    }
    const doc = fresh.resource;
    const markdown = (doc.content as string) ?? "";
    const content = formatDocumentContent(markdown, format);

    return {
      id: doc.id,
      title: doc.title,
      description: (doc.description as string | null | undefined) ?? "",
      content,
      format,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
    };
  },
  link: ({ result }) => {
    const id = (result as { id?: string } | null)?.id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
