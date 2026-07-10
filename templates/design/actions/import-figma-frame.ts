import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  buildScreenFilesFromFigmaNodes,
  fetchFigmaNode,
  resolveTargetNodeId,
  summarizeFidelity,
} from "../server/lib/figma-node-import.js";
import { saveImportedDesignFiles } from "../server/lib/import-design-files.js";
import { parseFigmaFileKey, parseFigmaNodeId } from "../shared/figma-url.js";

const schemaInput = z
  .object({
    figmaUrl: z
      .string()
      .trim()
      .optional()
      .describe(
        "Figma file/frame URL, e.g. https://www.figma.com/design/<fileKey>/<name>?node-id=<id>. A branch URL (/branch/<key>/) resolves to the branch's own file.",
      ),
    fileKey: z
      .string()
      .trim()
      .optional()
      .describe("Figma file key. Used when figmaUrl is omitted or has no key."),
    nodeId: z
      .string()
      .trim()
      .optional()
      .describe(
        "Figma node id (colon or dash form, e.g. '12:34' or '12-34'). Used when figmaUrl has no node-id. Defaults to the file's first top-level frame when omitted.",
      ),
    designId: z
      .string()
      .optional()
      .describe("Design id. Defaults to the active editor navigation state."),
    asNewScreen: z
      .boolean()
      .default(true)
      .describe(
        "Must be true today: the imported frame is always saved as a new screen. Reserved for a future 'replace existing screen' mode.",
      ),
  })
  .refine((value) => value.figmaUrl || value.fileKey, {
    message: "Pass figmaUrl or fileKey.",
    path: ["figmaUrl"],
  });

export default defineAction({
  description:
    "Import a Figma frame/component by URL or file key + node id, mapping it to pixel-accurate HTML (position, auto-layout as flexbox, text, fills/gradients, strokes, corner radii, effects) and saving it as a new Design screen. Unsupported node types (vector networks, boolean ops) render as exact PNG fallbacks instead of approximated shapes. Returns a fidelity report of which properties were exact, approximated, or image-fallback. Requires the saved FIGMA_ACCESS_TOKEN secret.",
  schema: schemaInput,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    if (args.asNewScreen === false) {
      throw new Error(
        "asNewScreen: false is not supported yet. Omit it or pass true — the imported frame is always saved as a new screen.",
      );
    }

    const fileKey =
      parseFigmaFileKey(args.fileKey) ?? parseFigmaFileKey(args.figmaUrl);
    if (!fileKey) {
      throw new Error("Could not find a Figma file key in the provided URL.");
    }
    const requestedNodeId =
      parseFigmaNodeId(args.nodeId) ?? parseFigmaNodeId(args.figmaUrl);

    const nodeId = await resolveTargetNodeId(fileKey, requestedNodeId);
    const rootNode = await fetchFigmaNode(fileKey, nodeId);

    const { files, fidelityEntries } = await buildScreenFilesFromFigmaNodes(
      fileKey,
      { [nodeId]: rootNode },
      {
        source: () => ({ figmaUrl: args.figmaUrl ?? null }),
      },
    );

    const saved = await saveImportedDesignFiles({
      designId: args.designId,
      sourceType: "figma-import",
      files,
    });

    return {
      ...saved,
      figma: { fileKey, nodeId, nodeName: rootNode.name ?? null },
      fidelityReport: summarizeFidelity(fidelityEntries),
      guidance:
        "Review fidelityReport.imageFallbacks for subtrees rendered as PNG (vector networks, boolean ops, unsupported node types) and fidelityReport.approximated for properties CSS cannot express exactly (rotation, per-side strokes, radial/angular/diamond gradients, blur radius scale).",
    };
  },
});
