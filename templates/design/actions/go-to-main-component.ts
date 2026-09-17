/**
 * go-to-main-component — Figma's "Go to main component".
 *
 * A canonical linked component has a persisted opaque id on its main root and
 * references. Resolve that id first. Legacy name-only annotations still use
 * the earliest same-name instance as their compatibility fallback.
 *
 * Navigation-only + inline/Alpine designs only (real-app sources return a
 * CTA). Because this writes the transient `navigate` application-state
 * command, it is exposed as the default POST mutation rather than a GET.
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  entriesForComponent,
  scanComponentLibrary,
} from "../shared/component-library.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  componentNameFor,
  componentNodeIdMatches,
} from "../shared/component-model.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

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

export default defineAction({
  description:
    "Resolve the 'main' instance of a component (Figma's Go to main " +
    "component). Canonical linked components resolve by their persisted " +
    "component id; legacy name-only annotations fall back to the earliest " +
    "same-name instance across the design's files. Returns isMain=true when " +
    "the selected instance is already the main; otherwise navigates the " +
    "editor to it.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component instance root"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Design file id the instance currently lives in; defaults to index.html",
      ),
  }),
  run: async ({ designId, nodeId, fileId }) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);

    if (sourceType !== "inline") {
      return {
        designId,
        nodeId,
        sourceType,
        ctaRequired: true,
        ctaMessage:
          "Go to main component requires a connected Builder app for " +
          "real-app sources. Not yet available.",
        isMain: false,
        navigated: false,
      };
    }

    const db = getDb();

    // ── Resolve the current node + component name ──────────────────────────
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

    const currentHtml = await liveContent(file.id, file.content ?? "");
    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };
    const currentProjection = buildCodeLayerProjection(currentHtml, {
      source: codeLayerSource,
    });

    const node = currentProjection.nodes.find((n) =>
      componentNodeIdMatches(n, nodeId),
    );
    if (!node) {
      throw new Error(
        `Node "${nodeId}" not found. Run get-code-layer-projection to list current ids.`,
      );
    }

    const componentName = componentNameFor(node);
    const componentId =
      node.dataAttributes[COMPONENT_ID_ATTR]?.trim() ||
      node.dataAttributes[COMPONENT_REF_ATTR]?.trim();
    if (!componentName && !componentId) {
      throw new Error(
        `Node "${nodeId}" is not a component root (no component name or linked identity).`,
      );
    }

    // ── Scan every design file for instances of this component ─────────────
    const allFiles = await db
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
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.fileType, "html"),
        ),
      )
      .orderBy(schema.designFiles.createdAt);

    // Use the freshest content we already read for the current file so the
    // instance we just resolved (possibly from a live collab doc) matches up
    // with `node.id` exactly.
    const filesForScan = allFiles.map((row) =>
      row.id === file.id ? { ...row, content: currentHtml } : row,
    );

    const entries = scanComponentLibrary(filesForScan);
    const matches = componentId
      ? entries.filter(
          (entry) =>
            entry.componentId === componentId ||
            entry.componentRef === componentId,
        )
      : entriesForComponent(entries, componentName!);

    if (matches.length === 0) {
      // Shouldn't happen (the current node itself matches), but guard anyway.
      throw new Error(
        `No instances of component "${componentName ?? componentId}" found across the design's files.`,
      );
    }
    const resolvedComponentName = componentName ?? matches[0]?.name;
    if (!resolvedComponentName) {
      throw new Error(
        `Component identity "${componentId}" has no named canonical root.`,
      );
    }

    const main = componentId
      ? (matches.find((entry) => entry.componentId === componentId) ??
        matches[0])
      : matches[0];
    // Compare against the caller's own stable `nodeId` param (a durable
    // data-agent-native-node-id), not `node.id` (an ephemeral id scoped to
    // this projection call) — `scanComponentLibrary` resolves the same
    // durable id for every entry, so this is an apples-to-apples comparison.
    const isMain = main.fileId === file.id && main.nodeId === nodeId;

    if (isMain) {
      return {
        designId,
        nodeId,
        componentName: resolvedComponentName,
        sourceType,
        ctaRequired: false,
        isMain: true,
        instanceCount: matches.length,
        navigated: false,
        note:
          matches.length === 1
            ? `"${resolvedComponentName}" has only one instance — this is it.`
            : `This is the earliest instance of "${resolvedComponentName}" across the design.`,
      };
    }

    await writeAppStateForCurrentTab("navigate", {
      view: "editor",
      designId,
      editorView: "single",
      fileId: main.fileId,
      filename: main.filename,
      selectedNodeId: main.nodeId,
      inspectorTab: "design",
      inspectorSection: "component",
    });

    return {
      designId,
      nodeId,
      componentName: resolvedComponentName,
      sourceType,
      ctaRequired: false,
      isMain: false,
      instanceCount: matches.length,
      main: {
        fileId: main.fileId,
        filename: main.filename,
        nodeId: main.nodeId,
        selector: main.selector,
      },
      navigated: true,
    };
  },
});
