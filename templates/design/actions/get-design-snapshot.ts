import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { buildDesignSnapshot } from "../server/lib/design-snapshot.js";
import { lockedLayerSnapshots } from "../shared/locked-layers.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

export default defineAction({
  description:
    "Get the CURRENT state of a design for an external agent to continue " +
    "from. Returns live file contents (Yjs collab text when a file is being " +
    "edited live, otherwise the stored content), the design's tweak " +
    "definitions, the user's applied tweak selections, and the resolved CSS " +
    "custom-property values so the agent sees the *tuned* design, not the " +
    "original generated tokens. Pass fileId or filename when continuing from " +
    "one selected screen so large multi-file designs stay bounded. Read-only.",
  schema: z.object({
    designId: z.string().describe("Design project ID to snapshot"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Optional design file ID to return. Use this after a variant pick to snapshot only the kept screen.",
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Optional design filename to return when fileId is unavailable.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design snapshot",
      description: "Open the current design in the real Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({ designId, fileId, filename }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      const err = new Error("Design not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }
    const design = access.resource as typeof schema.designs.$inferSelect;

    const snapshot = await buildDesignSnapshot(designId, design.data);
    const requestedFileId = fileId?.trim();
    const requestedFilename = filename?.trim();
    const files = requestedFileId
      ? snapshot.files.filter((file) => file.id === requestedFileId)
      : requestedFilename
        ? snapshot.files.filter((file) => file.filename === requestedFilename)
        : snapshot.files;

    if ((requestedFileId || requestedFilename) && files.length === 0) {
      const err = new Error("Design file not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }
    if (!requestedFileId && requestedFilename && files.length > 1) {
      const err = new Error(
        "Multiple design files match filename; pass fileId instead",
      ) as Error & { statusCode: number };
      err.statusCode = 409;
      throw err;
    }
    const boundedFile = requestedFileId || requestedFilename ? files[0] : null;

    return {
      designId,
      title: design.title,
      description: design.description ?? null,
      projectType: design.projectType,
      designSystemId: design.designSystemId ?? null,
      updatedAt: design.updatedAt,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        fileType: f.fileType,
        content: f.content,
        source: f.source,
      })),
      fileCount: files.length,
      totalFileCount: snapshot.files.length,
      tweaks: snapshot.tweaks,
      appliedTweaks: snapshot.appliedTweaks,
      resolvedCssVars: snapshot.resolvedCssVars,
      lockedLayers: files.flatMap((file) =>
        lockedLayerSnapshots(file.content).map((layer) => ({
          fileId: file.id,
          filename: file.filename,
          nodeId: layer.id,
          layerName: layer.label,
        })),
      ),
      deepLink: designDeepLink(designId),
      ...(boundedFile
        ? {
            editTarget: {
              designId,
              fileId: boundedFile.id,
              filename: boundedFile.filename,
            },
            nextRequiredAction:
              `Call edit-design exactly once with designId ${designId} and fileId ${boundedFile.id} (${boundedFile.filename}). ` +
              "Do not call delete-file or get-design-snapshot again unless edit-design fails with a concrete missing context error.",
          }
        : {}),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});
