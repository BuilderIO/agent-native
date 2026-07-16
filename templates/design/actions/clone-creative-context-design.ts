import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import {
  nativeCreativeArtifactFromMetadata,
  reassembleNativeCreativeArtifact,
} from "@agent-native/creative-context";
import { recordGenerationCreativeContext } from "@agent-native/creative-context/server";
import {
  createContextPack,
  getCreativeContextItem,
  getCreativeContextItemByExternalId,
} from "@agent-native/creative-context/store";
import { z } from "zod";

import {
  resolveImportDesignId,
  saveImportedDesignFiles,
} from "../server/lib/import-design-files.js";

export default defineAction({
  description:
    "Clone a version-pinned native Design artifact from the Creative Context library into the current Design project as editable HTML/CSS. Hierarchical Figma artboards are reassembled from their immutable child artifacts without AI regeneration.",
  schema: z.object({
    itemId: z.string().min(1).describe("Creative Context item id to clone."),
    itemVersionId: z
      .string()
      .min(1)
      .describe("Immutable item version id returned by get-context-item."),
    designId: z
      .string()
      .optional()
      .describe("Design id. Defaults to the active editor navigation state."),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async ({ itemId, itemVersionId, designId: explicitDesignId }) => {
    const contextState = (await readAppState("creative-context").catch(
      () => null,
    )) as { contextMode?: "auto" | "off" } | null;
    if (contextState?.contextMode === "off") {
      throw new Error(
        "Creative Context is off. Enable it before cloning a library design.",
      );
    }
    const designId = await resolveImportDesignId(explicitDesignId);
    await assertAccess("design", designId, "editor");
    const root = await getCreativeContextItem(itemId, itemVersionId);
    if (!root) {
      throw new Error("Creative Context item or pinned version was not found.");
    }
    const rootArtifact = nativeCreativeArtifactFromMetadata(
      root.version.metadata,
    );
    if (
      !rootArtifact ||
      rootArtifact.app !== "design" ||
      rootArtifact.format !== "design-html"
    ) {
      throw new Error(
        "Creative Context item is not an editable Design artifact.",
      );
    }
    const reassembled = await reassembleNativeCreativeArtifact({
      root,
      app: "design",
      format: "design-html",
      resolveChild: getCreativeContextItemByExternalId,
    });
    const pack = await createContextPack({
      name: `Clone: ${root.item.title}`.slice(0, 200),
      contextMode: "manual",
      request: {
        operation: "clone-native-artifact",
        appId: "design",
        rootItemId: root.item.id,
        rootItemVersionId: root.version.id,
      },
      members: reassembled.evidence.map((entry) => ({
        ...entry,
        reason: "Exact native artifact reuse",
      })),
    });
    const saved = await saveImportedDesignFiles({
      designId,
      sourceType: "creative-context-clone",
      preserveExactContent: true,
      files: [
        {
          filename: `${safeFilename(root.item.title)}.html`,
          fileType: "html",
          content: reassembled.html,
          source: {
            sourceType: "creative-context",
            contextPackId: pack.id,
            itemId: root.item.id,
            itemVersionId: root.version.id,
            externalId: root.item.externalId,
            sourceVersion: root.version.sourceVersion,
          },
          ...(reassembled.artifact.sourceBounds
            ? {
                preferredFrame: {
                  title: root.item.title,
                  width: reassembled.artifact.sourceBounds.width,
                  height: reassembled.artifact.sourceBounds.height,
                },
              }
            : {}),
        },
      ],
    });
    const savedFile = saved.files[0];
    if (!savedFile) throw new Error("Design clone produced no saved file.");
    const reuseLabels = reassembled.evidence.map((entry, index) => ({
      ...entry,
      kind: "native-artifact",
      label:
        entry.itemId === root.item.id
          ? root.item.title
          : `Native child ${index + 1}`,
      dataRole: "untrusted-reference" as const,
      elementId: `native-artifact:${index + 1}`,
      influence: "reused" as const,
    }));
    await recordGenerationCreativeContext({
      appId: "design",
      artifactType: "design-file",
      artifactId: savedFile.id,
      contextMode: "pinned",
      contextPackId: pack.id,
      reuseLabels,
      elementProvenance: reuseLabels.map((entry) => ({
        elementId: entry.elementId,
        influence: entry.influence,
        itemId: entry.itemId,
        itemVersionId: entry.itemVersionId,
        label: entry.label,
      })),
    });
    return {
      ...saved,
      contextPackId: pack.id,
      source: {
        itemId: root.item.id,
        itemVersionId: root.version.id,
        evidenceCount: reassembled.evidence.length,
      },
      fidelityReport: reassembled.artifact.fidelityReport,
      reusedWithoutRegeneration: true,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    return designId
      ? { url: `/design/${designId}`, label: "Open design", view: "editor" }
      : null;
  },
});

function safeFilename(value: string): string {
  const normalized = value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 160);
  return normalized || "creative-context-design";
}
