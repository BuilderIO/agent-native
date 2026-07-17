import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import {
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { resolveNativeContextCloneReference } from "@agent-native/creative-context/server";
import { z } from "zod";

import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { saveImportedDesignFiles } from "../server/lib/import-design-files.js";
import createDesign from "./create-design.js";

const payloadSchema = z.object({
  designId: z.string(),
  designData: z.string(),
  files: z.array(
    z.object({
      filename: z.string(),
      fileType: z.enum(["html", "css", "jsx", "asset"]),
      content: z.string(),
    }),
  ),
  tweaks: z.unknown().optional(),
  appliedTweaks: z.unknown().optional(),
  resolvedCssVars: z.unknown().optional(),
});

export default defineAction({
  description:
    "Clone an exact governed Design snapshot into a new editable Design project without exposing the source payload.",
  schema: z.object({
    contextId: z.string(),
    artifactKey: z.string(),
    resourceId: z.string(),
    expectedUpdatedAt: z.string().optional(),
    title: z.string().optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    const reference = await resolveNativeContextCloneReference({
      appId: "design",
      resourceType: "design",
      resourceId: args.resourceId,
      expectedUpdatedAt: args.expectedUpdatedAt,
      contextId: args.contextId,
      artifactKey: args.artifactKey,
    });
    const raw = await readPrivateBlob(
      reference.cloneHandle as PrivateBlobHandle,
    );
    const body = Buffer.from(raw.data).toString("utf8");
    const hash = createHash("sha256").update(body).digest("hex");
    if (
      raw.metadata?.appId !== "design" ||
      raw.metadata?.resourceType !== "design" ||
      raw.metadata?.resourceId !== args.resourceId ||
      raw.metadata?.contentHash !== hash
    )
      throw new Error(
        "Governed design clone payload failed integrity verification.",
      );
    const payload = payloadSchema.parse(JSON.parse(body));
    const created = await createDesign.run({
      title: args.title?.trim() || "Context design",
      projectType: "prototype",
    });
    const saved = await saveImportedDesignFiles({
      designId: created.id,
      sourceType: "creative-context-native-clone",
      preserveExactContent: true,
      files: payload.files.map((file) => ({
        ...file,
        source: {
          creativeContextItemVersionId: reference.publishedItemVersionId,
        },
      })),
    });
    if (saved.files.length !== payload.files.length)
      throw new Error("Design clone did not persist every saved file.");
    const capturedData = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(payload.designData));
    const {
      canvasFrames: _capturedFrames,
      screenMetadata: _capturedMetadata,
      ...capturedState
    } = capturedData;
    await mutateDesignData({
      designId: created.id,
      mutate: (current) => ({
        ...capturedState,
        canvasFrames: current.canvasFrames,
        screenMetadata: current.screenMetadata,
      }),
      isApplied: (persisted) =>
        Object.entries(capturedState).every(
          ([key, value]) =>
            JSON.stringify(persisted[key]) === JSON.stringify(value),
        ),
    });
    return {
      designId: saved.designId,
      title: created.title,
      fileCount: saved.files.length,
      urlPath: saved.urlPath,
      clonedExactVersion: reference.publishedItemVersionId,
    };
  },
});
