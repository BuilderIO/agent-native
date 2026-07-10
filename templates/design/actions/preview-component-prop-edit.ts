/**
 * preview-component-prop-edit — preview-only action.
 *
 * Computes the iframe bridge messages needed to preview a component prop
 * change on the canvas without persisting anything to the database or Yjs.
 *
 * The caller pushes the returned `bridgeMessages` into the iframe via the
 * existing `postMessage` channel (the same mechanism as `tweak-values` and
 * `style-change`).  No writes are performed here.
 *
 * Supported prop edit kinds:
 * - `alpineData`   — replaces the `x-data` attribute on the component root
 *                    (Alpine variant / state switch).  Returned as a
 *                    `style-change` bridge message targeting the node selector.
 * - `attribute`    — sets any HTML attribute (e.g. `class`, `aria-*`,
 *                    `data-agent-native-prop-*`).
 * - `classReplace` — replaces one Tailwind utility with another on the root
 *                    (lightweight responsive / variant preview via the
 *                    existing `responsive-class` edit kind understood by
 *                    the bridge).
 *
 * See DESIGN-STUDIO-PLAN.md §6.1 and §7 (preview vs apply contract).
 */

import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  componentNameFor,
  componentNodeIdMatches,
  extractProps,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    // Collab reads are best-effort; SQL content is the fallback.
  }
  return storedContent;
}

// ─── Bridge message shapes ────────────────────────────────────────────────────

/**
 * A bridge message the client pushes into the canvas iframe via postMessage.
 * The `type` matches the existing parent→iframe message vocabulary so no new
 * message types are introduced.
 */
export interface ComponentPropPreviewMessage {
  /** Matches the existing parent→iframe postMessage type vocabulary. */
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

// ─── Action ───────────────────────────────────────────────────────────────────

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

    // ── Access check ────────────────────────────────────────────────────────
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    // ── Fetch file ───────────────────────────────────────────────────────────
    const conditions = [
      accessFilter(schema.designs, schema.designShares),
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

    // ── Resolve node ─────────────────────────────────────────────────────────
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

    // ── Build bridge messages ────────────────────────────────────────────────
    // All edit kinds map to existing parent→iframe message types so the client
    // can push them without any new bridge surface.

    const messages: ComponentPropPreviewMessage[] = [];

    if (edit.kind === "alpineData") {
      // Replace the x-data expression — communicated as a style-change with
      // a special `attributeOverrides` key so the bridge can patch the DOM
      // attribute without a full HTML replace.
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
      // Communicate as a responsive-class intent so the bridge applies it via
      // the existing deterministic class-patch path.
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

    // Also emit a select-element message so the canvas highlights the node.
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
      /** Push each of these messages into the canvas iframe via postMessage. */
      bridgeMessages: messages,
      /** Snapshot of current observed props for before/after display. */
      currentProps: extractProps(node),
      note: "Preview only — no database writes performed. Call apply-component-prop-edit to persist.",
    };
  },
});
