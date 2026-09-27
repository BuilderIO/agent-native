import { defineAction } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import "../server/db/index.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  componentNameFor,
  componentNodeIdMatches,
  extractProps,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  return (
    await readLiveSourceFile({
      id: fileId,
      designId: "",
      filename: "index.html",
      fileType: "html",
      content: storedContent,
      createdAt: null,
      updatedAt: null,
    })
  ).content;
}

export interface ComponentPropPreviewMessage {
  type: "style-change" | "replace-document-content" | "select-element";
  selector?: string;
  nodeId?: string;
  attributeOverrides?: Record<string, string>;
  classEdit?: {
    kind: "class";
    operation: "replace";
    from: string;
    to: string;
  };
}

export default defineAction({
  description:
    "Preview a component prop edit on the canvas without persisting. " +
    "Returns bridge messages the client pushes into the canvas iframe via " +
    "postMessage to show the change immediately. Supports alpineData (x-data " +
    "attribute replace), attribute (arbitrary HTML attribute set), and " +
    "classReplace (Tailwind utility swap) edit kinds.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component root to preview"),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
    edit: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("alpineData"),
          value: z
            .string()
            .describe(
              "New x-data expression for the Alpine component root, " +
                "e.g. \"{ variant: 'outline', disabled: false }\"",
            ),
        }),
        z.object({
          kind: z.literal("attribute"),
          attribute: z.string().describe("HTML attribute name to set"),
          value: z.string().describe("New attribute value"),
        }),
        z.object({
          kind: z.literal("classReplace"),
          from: z.string().describe("Existing Tailwind class token to remove"),
          to: z.string().describe("Replacement Tailwind class token to add"),
        }),
      ])
      .describe("The prop edit to preview"),
  }),
  readOnly: true,
  http: { method: "POST" },
  run: async ({ designId, nodeId, fileId, edit }) => {
    const db = getDb();

    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const conditions = [
      accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
        includePublic: true,
      }),
      eq(schema.designFiles.designId, designId),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.filename, "index.html"),
    ];

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) throw new Error("Design HTML file not found.");

    const html = await liveContent(file.id, file.content ?? "");

    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };

    const projection = buildCodeLayerProjection(html, {
      source: codeLayerSource,
    });

    const node = projection.nodes.find((n) =>
      componentNodeIdMatches(n, nodeId),
    );
    if (!node) {
      throw new Error(
        `Node "${nodeId}" not found. Run get-code-layer-projection to list current ids.`,
      );
    }

    const componentName = componentNameFor(node);
    if (!componentName) {
      throw new Error(
        `Node "${nodeId}" is not a component root (no data-agent-native-component attribute).`,
      );
    }

    const messages: ComponentPropPreviewMessage[] = [];

    if (edit.kind === "alpineData") {
      messages.push({
        type: "style-change",
        selector: node.selector,
        nodeId,
        attributeOverrides: { "x-data": edit.value },
      });
    } else if (edit.kind === "attribute") {
      messages.push({
        type: "style-change",
        selector: node.selector,
        nodeId,
        attributeOverrides: { [edit.attribute]: edit.value },
      });
    } else if (edit.kind === "classReplace") {
      messages.push({
        type: "style-change",
        selector: node.selector,
        nodeId,
        classEdit: {
          kind: "class",
          operation: "replace",
          from: edit.from,
          to: edit.to,
        },
      });
    }

    messages.push({
      type: "select-element",
      selector: node.selector,
      nodeId,
    });

    const sourceType = designSourceTypeFromData(
      (access.resource as { data?: unknown }).data,
    );

    return {
      designId,
      nodeId,
      componentName,
      sourceType,
      editKind: edit.kind,
      bridgeMessages: messages,
      currentProps: extractProps(node),
      note: "Preview only — no database writes performed. Call apply-component-prop-edit to persist.",
    };
  },
});
