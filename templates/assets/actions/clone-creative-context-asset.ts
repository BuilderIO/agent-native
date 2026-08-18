import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import {
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { resolveNativeContextCloneReference } from "@agent-native/creative-context/server";
import { z } from "zod";

import { createAssetFromBuffer } from "../server/lib/assets.js";
import { getAssetOrThrow, requireLibrary } from "./_helpers.js";

export default defineAction({
  description:
    "Clone immutable governed media bytes into an editable Assets library without exposing the private source payload.",
  schema: z.object({
    contextId: z.string(),
    artifactKey: z.string(),
    resourceId: z.string(),
    expectedUpdatedAt: z.string().optional(),
    libraryId: z.string(),
    title: z.string().optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    await requireLibrary(args.libraryId);
    const reference = await resolveNativeContextCloneReference({
      appId: "assets",
      resourceType: "asset",
      resourceId: args.resourceId,
      expectedUpdatedAt: args.expectedUpdatedAt,
      contextId: args.contextId,
      artifactKey: args.artifactKey,
    });
    const raw = await readPrivateBlob(
      reference.cloneHandle as PrivateBlobHandle,
    );
    const bytes = Buffer.from(raw.data);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (
      raw.metadata?.appId !== "assets" ||
      raw.metadata?.resourceType !== "asset" ||
      raw.metadata?.resourceId !== args.resourceId ||
      raw.metadata?.contentHash !== hash
    )
      throw new Error(
        "Governed asset clone payload failed integrity verification.",
      );
    const created = await createAssetFromBuffer({
      libraryId: args.libraryId,
      buffer: bytes,
      mimeType: raw.mimeType ?? "application/octet-stream",
      role: "style_reference",
      status: "reference",
      title: args.title?.trim() || "Context asset",
      metadata: {
        creativeContext: {
          itemVersionId: reference.publishedItemVersionId,
          sourceAssetId: args.resourceId,
        },
      },
    });
    const persisted = await getAssetOrThrow(created.id);
    if (persisted.id !== created.id || persisted.libraryId !== args.libraryId)
      throw new Error("Asset clone did not persist.");
    return {
      id: persisted.id,
      libraryId: persisted.libraryId,
      title: persisted.title,
      clonedExactVersion: reference.publishedItemVersionId,
    };
  },
});
