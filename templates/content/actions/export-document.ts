import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { buildDocumentExport } from "../shared/document-export.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Export a Content document as PDF-ready HTML, Markdown, or standalone HTML. PDF exports are print-ready HTML intended for the browser print dialog.",
  schema: z.object({
    id: z.string().describe("Document ID (required)"),
    format: z
      .enum(["pdf", "markdown", "html"])
      .default("pdf")
      .describe("Export format: pdf, markdown, or html."),
    title: z
      .string()
      .max(500)
      .optional()
      .describe("Optional unsaved editor title to export."),
    content: z
      .string()
      .max(2_000_000)
      .optional()
      .describe("Optional unsaved editor markdown content to export."),
  }),
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id, format, title, content }) => {
    const access = await resolveAccess("document", id);
    if (!access) throw new Error(`Document "${id}" not found`);

    const doc = access.resource;
    const payload = buildDocumentExport({
      id: doc.id,
      title: title ?? doc.title,
      content: content ?? doc.content,
      updatedAt: doc.updatedAt,
      format,
    });

    return {
      ...payload,
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
