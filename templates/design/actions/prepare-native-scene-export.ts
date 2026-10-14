import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import { parseEffectsFromHtml } from "../shared/native-effects.js";

const MAX_SOURCE_BYTES = 3_000_000;
const MAX_FRAME_PIXELS = 8_388_608;

export default defineAction({
  description:
    "Pin one currently mounted Design HTML scene for a PNG of its last committed native frame. " +
    "Only the 16 curated exact Tier 1 definitions can execute. The returned HTML and versionHash are source evidence, not a rendered image; the client must verify its mounted scene and capture actual committed pixels.",
  schema: z
    .object({
      designId: z.string().min(1),
      fileId: z.string().min(1),
      viewportWidth: z.coerce.number().int().min(1).max(4096),
      viewportHeight: z.coerce.number().int().min(1).max(4096),
      pixelRatio: z.coerce.number().finite().gt(0).max(4),
    })
    .refine(
      ({ viewportWidth, viewportHeight, pixelRatio }) =>
        viewportWidth * viewportHeight <= MAX_FRAME_PIXELS &&
        Math.ceil(viewportWidth * pixelRatio) <= 4096 &&
        Math.ceil(viewportHeight * pixelRatio) <= 4096 &&
        Math.ceil(viewportWidth * pixelRatio) *
          Math.ceil(viewportHeight * pixelRatio) <=
          MAX_FRAME_PIXELS,
      { message: "Native PNG frame exceeds the bounded viewport." },
    ),
  readOnly: true,
  http: { method: "GET" },
  run: async ({
    designId,
    fileId,
    viewportWidth,
    viewportHeight,
    pixelRatio,
  }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: false,
      includeBoard: true,
    });
    if (workspace.sourceType !== "inline")
      fail("Native PNG requires an inline Design source.", {
        errorCode: "native_export_source_unsupported",
        statusCode: 422,
      });
    const file = workspace.files.find((candidate) => candidate.id === fileId);
    if (!file || file.fileType !== "html")
      fail("Selected HTML scene was not found.", {
        errorCode: "native_export_screen_not_found",
        statusCode: 404,
      });
    const stored = await loadSelectedSourceWorkspaceFile(file);
    if (!stored)
      fail("Selected scene changed during PNG preparation.", {
        errorCode: "native_export_source_conflict",
        statusCode: 409,
      });
    const live = await readLiveSourceFile(stored);
    if (new TextEncoder().encode(live.content).byteLength > MAX_SOURCE_BYTES)
      fail("Native PNG source exceeds the 3 MB limit.", {
        errorCode: "native_export_source_too_large",
        statusCode: 413,
      });
    const parsed = parseEffectsFromHtml(live.content);
    if (parsed.errors.length || !parsed.document?.instances.length)
      fail("Selected scene has no readable native effect instances.", {
        errorCode: "native_export_manifest_unreadable",
        statusCode: 422,
      });
    const hashes = new Set<string>();
    for (const instance of parsed.document.instances.filter(
      (item) => item.enabled,
    )) {
      const definition = parsed.document.definitions.find(
        (candidate) =>
          candidate.id === instance.definitionId &&
          candidate.version === instance.definitionVersion,
      );
      const builtin = NATIVE_EFFECT_DEFINITION_CATALOG.find(
        (candidate) =>
          candidate.id === instance.definitionId &&
          candidate.version === instance.definitionVersion,
      );
      if (
        !definition ||
        !builtin ||
        (await hashEffectDefinition(definition)) !==
          (await hashEffectDefinition(builtin))
      )
        fail("This scene contains a native definition outside Tier 1.", {
          errorCode: "definition-outside-tier-1",
          statusCode: 422,
        });
      hashes.add(await hashEffectDefinition(builtin));
    }
    return {
      designId,
      fileId,
      viewport: { width: viewportWidth, height: viewportHeight },
      initialPixelRatio: pixelRatio,
      html: live.content,
      versionHash: live.versionHash,
      sourceVersions: [
        { fileId, filename: file.filename, versionHash: live.versionHash },
      ],
      approvedDefinitionHashes: [...hashes],
      instanceTargets: parsed.document.instances
        .filter((item) => item.enabled)
        .map((item) => ({ instanceId: item.id, nodeId: item.nodeId })),
    };
  },
});
