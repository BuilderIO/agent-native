import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  reassembleNativeCreativeArtifact,
  validateCompiledNativeHtml,
} from "../native-artifact-reassembly.js";
import { nativeCreativeArtifactFromMetadata } from "../native-artifact.js";
import {
  sanitizePublicString,
  serializePublicContextDetail,
} from "../server/public-serialization.js";
import { ensureContextItemHydration } from "../server/retrieval.js";
import {
  delimitUntrustedMetadata,
  delimitUntrustedReference,
  UNTRUSTED_REFERENCE_ROLE,
} from "../server/untrusted-reference.js";
import {
  getCreativeContextItem,
  getCreativeContextItemByExternalId,
} from "../store/index.js";

const MAX_STORED_NATIVE_CODE_BYTES = 128 * 1024;

export default defineAction({
  description:
    "Get one accessible curated creative-context item at a pinned immutable version.",
  schema: z.object({
    itemId: z.string().min(1),
    itemVersionId: z.string().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const context = await getCreativeContextItem(
      args.itemId,
      args.itemVersionId,
    );
    if (!context) throw new Error("Context item not found or not accessible");
    const publicContext = serializePublicContextDetail(context);
    const nativeArtifact = nativeCreativeArtifactFromMetadata(
      context.version.metadata,
    );
    const nativeCode = nativeArtifact
      ? nativeArtifact.manifest
        ? boundedStoredNativeCode(context.version.content, nativeArtifact)
        : ((
            await reassembleNativeCreativeArtifact({
              root: context,
              app: nativeArtifact.app,
              format: nativeArtifact.format,
              resolveChild: getCreativeContextItemByExternalId,
            }).catch(() => null)
          )?.html ?? null)
      : null;
    return {
      ...publicContext,
      pendingJobId: await ensureContextItemHydration(context.item.id),
      dataRole: UNTRUSTED_REFERENCE_ROLE,
      item: {
        ...publicContext.item,
        dataRole: UNTRUSTED_REFERENCE_ROLE,
        externalId: sanitizePublicString(context.item.externalId),
        title: delimitUntrustedReference(
          sanitizePublicString(context.item.title),
        ),
        provenance: delimitUntrustedMetadata(publicContext.item.provenance),
      },
      version: {
        ...publicContext.version,
        dataRole: UNTRUSTED_REFERENCE_ROLE,
        title: delimitUntrustedReference(
          sanitizePublicString(context.version.title),
        ),
        content: delimitUntrustedReference(
          sanitizePublicString(context.version.content),
        ),
        nativeCode:
          nativeArtifact && nativeCode
            ? {
                dataRole: UNTRUSTED_REFERENCE_ROLE,
                format: nativeArtifact.format,
                content: nativeCode,
              }
            : null,
        summary: context.version.summary
          ? delimitUntrustedReference(
              sanitizePublicString(context.version.summary),
            )
          : null,
        sourceVersion: context.version.sourceVersion
          ? sanitizePublicString(context.version.sourceVersion)
          : null,
        parseError: context.version.parseError
          ? delimitUntrustedReference(
              sanitizePublicString(context.version.parseError),
            )
          : null,
        metadata: delimitUntrustedMetadata(publicContext.version.metadata),
      },
      chunks: publicContext.chunks.map((chunk) => ({
        ...chunk,
        dataRole: UNTRUSTED_REFERENCE_ROLE,
        text: delimitUntrustedReference(sanitizePublicString(chunk.text)),
        metadata: delimitUntrustedMetadata(chunk.metadata),
      })),
      media: publicContext.media.map((media) => ({
        ...media,
        dataRole: UNTRUSTED_REFERENCE_ROLE,
        altText: media.altText
          ? delimitUntrustedReference(sanitizePublicString(media.altText))
          : null,
        caption: media.caption
          ? delimitUntrustedReference(sanitizePublicString(media.caption))
          : null,
        ocrText: media.ocrText
          ? delimitUntrustedReference(sanitizePublicString(media.ocrText))
          : null,
        metadata: delimitUntrustedMetadata(media.metadata),
      })),
      edges: publicContext.edges.map((edge) => ({
        ...edge,
        dataRole: UNTRUSTED_REFERENCE_ROLE,
        toExternalId: edge.toExternalId
          ? sanitizePublicString(edge.toExternalId)
          : null,
        metadata: delimitUntrustedMetadata(edge.metadata),
      })),
    };
  },
});

function boundedStoredNativeCode(
  content: string,
  artifact: Parameters<typeof validateCompiledNativeHtml>[1],
): string | null {
  if (Buffer.byteLength(content, "utf8") > MAX_STORED_NATIVE_CODE_BYTES) {
    return null;
  }
  try {
    validateCompiledNativeHtml(content, artifact);
    return content;
  } catch {
    return null;
  }
}
