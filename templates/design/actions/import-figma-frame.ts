import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  FIGMA_IMPORT_ERROR_CODES,
  failFigmaImport,
} from "../server/lib/figma-import-errors.js";
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
import createDesign from "./create-design.js";
import deleteDesign from "./delete-design.js";

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
    createNew: z
      .boolean()
      .default(false)
      .describe(
        "Import into a new design instead of the active editor. Cannot be combined with designId. The project is created only after Figma content has been prepared successfully.",
      ),
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
  })
  .refine((value) => !value.createNew || !value.designId, {
    message: "Pass createNew or designId, not both.",
    path: ["designId"],
  });

export default defineAction({
  description:
    "Import a Figma frame/component by URL or file key + node id, mapping supported structure to fidelity-aware HTML (position, auto-layout as flexbox, text, fills/gradients, strokes, corner radii, effects) and saving it as a new Design screen. Geometry and paint models HTML/CSS cannot represent faithfully (including masks, vector/boolean geometry, lines/arcs, advanced strokes/text, and transformed image crops) use rendered fallbacks instead of silently importing the wrong visual. Returns a fidelity report of which nodes were exact, approximated, or image-fallback. Requires the saved FIGMA_ACCESS_TOKEN secret. A failure names its own cause (unusable URL, node the token cannot read, oversized frame, Figma rate limit, missing durable file storage) and carries a stable errorCode — relay that message to the user instead of reporting a generic failure.",
  schema: schemaInput,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args, context) => {
    if (args.createNew && args.designId) {
      failFigmaImport(
        "Pass createNew or designId, not both.",
        FIGMA_IMPORT_ERROR_CODES.targetInvalid,
      );
    }
    if (args.createNew && !getRequestUserEmail()) {
      failFigmaImport(
        "Sign in before importing a new design.",
        FIGMA_IMPORT_ERROR_CODES.authRequired,
        { statusCode: 401 },
      );
    }
    if (args.asNewScreen === false) {
      failFigmaImport(
        "asNewScreen: false is not supported yet. Omit it or pass true — the imported frame is always saved as a new screen.",
        FIGMA_IMPORT_ERROR_CODES.unsupportedOption,
      );
    }

    const fileKey =
      parseFigmaFileKey(args.fileKey) ?? parseFigmaFileKey(args.figmaUrl);
    if (!fileKey) {
      failFigmaImport(
        "Could not find a Figma file key in the provided URL.",
        FIGMA_IMPORT_ERROR_CODES.urlInvalid,
      );
    }
    const requestedNodeId =
      parseFigmaNodeId(args.nodeId) ?? parseFigmaNodeId(args.figmaUrl);

    const existingDesignId = args.createNew
      ? undefined
      : await resolveImportDesignId(args.designId);
    if (existingDesignId) {
      await assertAccess("design", existingDesignId, "editor");
    }

    const nodeId = await resolveTargetNodeId(fileKey, requestedNodeId);
    const rootNode = await fetchFigmaNode(fileKey, nodeId);

    const { files, fidelityEntries, omissionWarnings } =
      await buildScreenFilesFromFigmaNodes(
        fileKey,
        { [nodeId]: rootNode },
        {
          source: () => ({ figmaUrl: args.figmaUrl ?? null }),
        },
      );

    const createdDesignId = existingDesignId
      ? undefined
      : (
          await createDesign.run(
            {
              title: rootNode.name?.trim() || "Figma import",
              projectType: "prototype",
              designSystemId: null,
            },
            context,
          )
        ).id;
    const designId = existingDesignId ?? createdDesignId;
    if (!designId) {
      throw new Error("Figma import could not determine the new design id.");
    }
    if (existingDesignId) {
      await snapshotDesignBeforeAgentEdit(designId, context);
    }
    let saved: Awaited<ReturnType<typeof saveImportedDesignFiles>>;
    try {
      saved = await saveImportedDesignFiles({
        designId,
        sourceType: "figma-import",
        files,
      });
    } catch (error) {
      if (createdDesignId) {
        try {
          await deleteDesign.run({ id: createdDesignId }, context);
        } catch (cleanupError) {
          const importMessage =
            error instanceof Error ? error.message : String(error);
          const cleanupMessage =
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError);
          throw new Error(
            `Figma import failed and its new design could not be cleaned up. Import error: ${importMessage}; cleanup error: ${cleanupMessage}`,
          );
        }
      }
      throw error;
    }

    return {
      ...saved,
      warnings: [...(saved.warnings ?? []), ...omissionWarnings],
      figma: { fileKey, nodeId, nodeName: rootNode.name ?? null },
      fidelityReport: summarizeFidelity(fidelityEntries),
      guidance:
        "Review fidelityReport.imageFallbacks for subtrees rendered as PNG (masks, vector/boolean geometry, lines/arcs, advanced strokes/text, transformed image crops, and unsupported node types) and fidelityReport.approximated for properties CSS cannot express exactly (rotation, per-side stroke alignment, radial/angular/diamond gradients, blur radius scale, and live component/variable/prototype semantics).",
    };
  },
});
