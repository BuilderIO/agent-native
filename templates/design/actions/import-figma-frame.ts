import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  buildScreenFilesFromFigmaNodes,
  fetchFigmaNode,
  resolveTargetNodeId,
  summarizeFidelity,
} from "../server/lib/figma-node-import.js";
import {
  resolveImportDesignId,
  saveImportedDesignFiles,
} from "../server/lib/import-design-files.js";
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
    "Import a Figma frame/component by URL or file key + node id, mapping supported structure to fidelity-aware HTML (position, auto-layout as flexbox, text, fills/gradients, strokes, corner radii, effects) and saving it as a new Design screen. Geometry and paint models HTML/CSS cannot represent faithfully (including masks, vector/boolean geometry, lines/arcs, advanced strokes/text, and transformed image crops) use rendered fallbacks instead of silently importing the wrong visual. Returns a fidelity report of which nodes were exact, approximated, or image-fallback. Requires the saved FIGMA_ACCESS_TOKEN secret.",
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

    // Validate the target before any provider fetch, rendered-fallback
    // download, or durable upload. saveImportedDesignFiles checks again at
    // mutation time, but waiting until then leaves external work and orphaned
    // assets behind when a caller names a design they cannot edit.
    const designId = await resolveImportDesignId(args.designId);
    await assertAccess("design", designId, "editor");

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
      designId,
      sourceType: "figma-import",
      files,
    });

    return {
      ...saved,
      figma: { fileKey, nodeId, nodeName: rootNode.name ?? null },
      fidelityReport: summarizeFidelity(fidelityEntries),
      guidance:
        "Review fidelityReport.imageFallbacks for subtrees rendered as PNG (masks, vector/boolean geometry, lines/arcs, advanced strokes/text, transformed image crops, and unsupported node types) and fidelityReport.approximated for properties CSS cannot express exactly (rotation, per-side stroke alignment, radial/angular/diamond gradients, blur radius scale, and live component/variable/prototype semantics).",
    };
  },
});
