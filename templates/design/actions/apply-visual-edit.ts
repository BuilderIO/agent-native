import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
  applyText,
  getText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  applyVisualEdit,
  type CodeLayerSource,
  type EditIntent,
} from "../shared/code-layer.js";

type VisualEditActionSource = CodeLayerSource & { html?: string };

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const sourceSchema = z.preprocess(
  parseJsonString,
  z
    .object({
      kind: z
        .enum(["design-file", "inline-html", "local-file", "remote-url"])
        .default("design-file"),
      designId: z.string().optional(),
      fileId: z.string().optional(),
      filename: z.string().optional().default("index.html"),
      path: z.string().optional(),
      url: z.string().optional(),
      revision: z.string().optional(),
      html: z.string().optional(),
    })
    .superRefine((source, ctx) => {
      if (source.kind === "design-file" && !source.designId && !source.fileId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["designId"],
          message: "designId or fileId is required for design-file sources",
        });
      }
    }),
);

const targetSchema = z.object({
  nodeId: z.string().optional(),
  selector: z.string().optional(),
});

const intentSchema = z.preprocess(
  parseJsonString,
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("style"),
      target: targetSchema,
      property: z
        .string()
        .describe(
          "CSS property to set. Deterministic edits cover the visual editor's common layout, typography, fill, stroke, effect, transform, and spacing properties.",
        ),
      value: z.string().describe("CSS value to write into the inline style."),
    }),
    z.object({
      kind: z.literal("class"),
      target: targetSchema,
      operation: z.enum(["add", "remove", "replace", "set"]),
      className: z.string().optional(),
      classNames: z.array(z.string()).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    z.object({
      kind: z.literal("textContent"),
      target: targetSchema,
      value: z.string().describe("Text content for a leaf HTML element."),
      html: z
        .string()
        .optional()
        .describe(
          "Optional sanitized inner HTML for preserving styled inline text runs.",
        ),
    }),
    z.object({
      kind: z.literal("moveNode"),
      target: targetSchema,
      anchor: targetSchema,
      placement: z.enum(["before", "after", "inside"]),
    }),
  ]),
);

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // Collab reads are best-effort; SQL content remains the fallback.
  }
  return storedContent;
}

async function resolveEditableDesignFile(
  source: VisualEditActionSource,
): Promise<{
  id: string;
  designId: string;
  filename: string;
  content: string;
  codeLayerSource: CodeLayerSource;
}> {
  if (!source.fileId && !source.designId) {
    throw new Error(
      "source.designId or source.fileId is required for design-file.",
    );
  }

  const db = getDb();
  const conditions = [
    accessFilter(schema.designs, schema.designShares),
    source.fileId
      ? eq(schema.designFiles.id, source.fileId)
      : eq(schema.designFiles.designId, source.designId ?? ""),
  ];
  if (!source.fileId) {
    conditions.push(
      eq(schema.designFiles.filename, source.filename ?? "index.html"),
    );
  }

  const [file] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
    })
    .from(schema.designFiles)
    .innerJoin(
      schema.designs,
      eq(schema.designFiles.designId, schema.designs.id),
    )
    .where(and(...conditions))
    .limit(1);

  if (!file) {
    throw new Error("Design HTML file not found.");
  }
  if (file.fileType !== "html") {
    throw new Error("Visual code-layer edits only support HTML files for now.");
  }

  await assertAccess("design", file.designId, "editor");

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    content: await liveContent(file.id, file.content ?? ""),
    codeLayerSource: {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      revision: source.revision,
    },
  };
}

async function persistDesignFileEdit(file: {
  id: string;
  designId: string;
  content: string;
}): Promise<void> {
  await assertAccess("design", file.designId, "editor");

  const db = getDb();
  const now = new Date().toISOString();

  agentEnterDocument(file.id);
  try {
    await db
      .update(schema.designFiles)
      .set({ content: file.content, updatedAt: now })
      .where(eq(schema.designFiles.id, file.id));

    if (await hasCollabState(file.id)) {
      await applyText(file.id, file.content, "content", "agent");
    } else {
      await seedFromText(file.id, file.content);
    }

    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));
  } finally {
    agentLeaveDocument(file.id);
  }
}

export default defineAction({
  description:
    "Apply one deterministic visual edit to a code-backed HTML design layer. " +
    "Supports safe inline style, class, and leaf textContent edits on inline/SQL HTML files; escalates ambiguous or structural edits with PatchResult statuses.",
  schema: z.object({
    source: sourceSchema.describe(
      "Edit source. Use kind=design-file with designId/filename or fileId to persist into SQL; kind=inline-html with html for a preview-only patch.",
    ),
    intent: intentSchema.describe(
      "Visual edit intent targeting a CodeLayerProjection nodeId or selector.",
    ),
    includeContent: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include patched HTML content in the response."),
  }),
  run: async ({ source, intent, includeContent }) => {
    const actionSource = source as VisualEditActionSource;
    const editIntent = intent as EditIntent;

    if (actionSource.kind === "inline-html") {
      const codeLayerSource: CodeLayerSource = {
        kind: "inline-html",
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const patch = applyVisualEdit(actionSource.html ?? "", editIntent, {
        source: codeLayerSource,
      });
      return {
        result: patch.result,
        projection: patch.projection,
        patchedContent: includeContent ? patch.content : undefined,
        bytesBefore: (actionSource.html ?? "").length,
        bytesAfter: patch.content.length,
      };
    }

    if (actionSource.kind !== "design-file") {
      const codeLayerSource: CodeLayerSource = {
        kind: actionSource.kind,
        path: actionSource.path,
        url: actionSource.url,
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const patch = applyVisualEdit("", editIntent, {
        source: codeLayerSource,
      });
      return {
        result: patch.result,
        projection: patch.projection,
        bytesBefore: 0,
        bytesAfter: 0,
      };
    }

    const file = await resolveEditableDesignFile(actionSource);
    const patch = applyVisualEdit(file.content, editIntent, {
      source: file.codeLayerSource,
    });

    if (patch.result.target) {
      agentUpdateSelection(file.id, {
        selection: patch.result.target.selector,
        nodeId: patch.result.target.nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    if (patch.result.status === "applied" && patch.result.changed) {
      await persistDesignFileEdit({
        id: file.id,
        designId: file.designId,
        content: patch.content,
      });
    }

    return {
      result: patch.result,
      projection: patch.projection,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      persisted: patch.result.status === "applied" && patch.result.changed,
      patchedContent: includeContent ? patch.content : undefined,
      bytesBefore: file.content.length,
      bytesAfter: patch.content.length,
    };
  },
});
