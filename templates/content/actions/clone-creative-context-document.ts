import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import {
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { resolveNativeContextCloneReference } from "@agent-native/creative-context/server";
import { z } from "zod";

import createDocument from "./create-document.js";

export default defineAction({
  description:
    "Clone one exact governed Markdown document without returning its private source payload.",
  schema: z.object({
    contextId: z.string(),
    artifactKey: z.string(),
    resourceId: z.string(),
    expectedUpdatedAt: z.string().optional(),
    title: z.string().optional(),
    parentId: z.string().optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    const reference = await resolveNativeContextCloneReference({
      appId: "content",
      resourceType: "document",
      resourceId: args.resourceId,
      expectedUpdatedAt: args.expectedUpdatedAt,
      contextId: args.contextId,
      artifactKey: args.artifactKey,
    });
    const raw = await readPrivateBlob(
      reference.cloneHandle as PrivateBlobHandle,
    );
    const content = Buffer.from(raw.data).toString("utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    if (
      raw.metadata?.appId !== "content" ||
      raw.metadata?.resourceType !== "document" ||
      raw.metadata?.resourceId !== args.resourceId ||
      raw.metadata?.contentHash !== hash
    )
      throw new Error(
        "Governed document clone payload failed integrity verification.",
      );
    const result = await createDocument.run({
      title: args.title?.trim() || "Context document",
      content,
      ...(args.parentId ? { parentId: args.parentId } : {}),
    });
    if (!result?.id) throw new Error("Document clone did not persist.");
    return {
      id: result.id,
      title: result.title,
      urlPath: result.urlPath,
      clonedExactVersion: reference.publishedItemVersionId,
    };
  },
});
