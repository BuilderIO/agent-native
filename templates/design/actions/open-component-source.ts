import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  componentNameFor,
  componentNodeIdMatches,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
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

export default defineAction({
  description:
    "Navigate to a component's source: for inline/Alpine designs, selects " +
    "the component root in the editor and returns the design file as the " +
    "source location. For real-app sources (localhost / fusion), resolves the " +
    "external source file path + export name via the component_index and the " +
    "resolveNodeToFile bridge capability, and emits a navigation command so the " +
    "IDE can open the file at the correct line.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe("data-agent-native-node-id of the component instance root"),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
  }),
  run: async ({ designId, nodeId, fileId }) => {
    const db = getDb();

    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const caps = resolveSourceCapabilities(sourceType);
    const canResolveToFile = hasCapability(caps, "resolveNodeToFile");

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

    const [indexRow] = await db
      .select({
        id: schema.componentIndex.id,
        filePath: schema.componentIndex.filePath,
        exportName: schema.componentIndex.exportName,
      })
      .from(schema.componentIndex)
      .where(
        and(
          eq(schema.componentIndex.designId, designId),
          eq(schema.componentIndex.name, componentName),
        ),
      )
      .limit(1);

    const isRealApp = sourceType !== "inline";
    const externalFilePath =
      isRealApp && canResolveToFile ? (indexRow?.filePath ?? null) : null;
    const exportName =
      isRealApp && canResolveToFile ? (indexRow?.exportName ?? null) : null;

    const sourceLocation = {
      designFileId: file.id,
      designFilename: file.filename,
      nodeId,
      selector: node.selector,
      externalFilePath,
      exportName,
    };

    await writeAppStateForCurrentTab("navigate", {
      view: "editor",
      designId,
      editorView: "single",
      fileId: file.id,
      filename: file.filename,
      selectedNodeId: nodeId,
      inspectorTab: "design",
      inspectorSection: "component",
    });

    return {
      designId,
      nodeId,
      componentName,
      sourceType,
      sourceLocation,
      capabilities: {
        canResolveToFile,
        hasExternalSource: Boolean(externalFilePath),
        ctaRequired: isRealApp && !canResolveToFile,
        ctaMessage:
          isRealApp && !canResolveToFile
            ? "Jump to external source file requires the resolveNodeToFile bridge capability. Connect Builder (free tier available) and run index-components to enable full jump-to-source."
            : isRealApp && !externalFilePath
              ? "Component source file not yet indexed. Run index-components to populate file paths."
              : undefined,
      },
      navigated: true,
    };
  },
});
