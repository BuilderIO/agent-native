import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  reassembleNativeCreativeArtifact,
  validateCompiledNativeHtml,
} from "../native-artifact-reassembly.js";
import {
  nativeCreativeArtifactFromMetadata,
  type NativeCreativeArtifact,
} from "../native-artifact.js";
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
      ? await publicNativeCode(context, nativeArtifact)
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
        nativeCode: nativeArtifact && nativeCode ? nativeCode : null,
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

async function publicNativeCode(
  context: NonNullable<Awaited<ReturnType<typeof getCreativeContextItem>>>,
  artifact: NativeCreativeArtifact,
) {
  try {
    const content = artifact.manifest
      ? context.version.content
      : (
          await reassembleNativeCreativeArtifact({
            root: context,
            app: artifact.app,
            format: artifact.format,
            resolveChild: getCreativeContextItemByExternalId,
          })
        ).html;
    validateCompiledNativeHtml(content, artifact);
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength <= MAX_STORED_NATIVE_CODE_BYTES) {
      return {
        dataRole: UNTRUSTED_REFERENCE_ROLE,
        format: artifact.format,
        content,
        ...(artifact.manifest
          ? { retrieval: nativeCodeRetrieval(context, artifact) }
          : {}),
      };
    }
    return {
      dataRole: UNTRUSTED_REFERENCE_ROLE,
      format: artifact.format,
      content: null,
      oversized: true,
      byteLength,
      maxInlineBytes: MAX_STORED_NATIVE_CODE_BYTES,
      retrieval: nativeCodeRetrieval(context, artifact),
      instruction:
        "Use the exact clone action for the complete artifact. For a manifest artifact, inspect individually pinned parts with get-context-item; never concatenate a truncated HTML fragment.",
    };
  } catch {
    return null;
  }
}

function nativeCodeRetrieval(
  context: NonNullable<Awaited<ReturnType<typeof getCreativeContextItem>>>,
  artifact: NativeCreativeArtifact,
) {
  return {
    mode: artifact.manifest ? "manifest-parts" : "exact-clone-only",
    root: {
      itemId: context.item.id,
      itemVersionId: context.version.id,
    },
    cloneAction:
      artifact.app === "slides"
        ? "clone-context-slide"
        : "clone-creative-context-design",
    parts: (artifact.manifest?.children ?? []).map((child) => {
      const edge = context.edges.find(
        (candidate) =>
          candidate.relation === "contains-native-child" &&
          candidate.toExternalId === child.externalId,
      );
      return {
        externalId: sanitizePublicString(child.externalId),
        itemId: edge?.toItemId ?? null,
        itemVersionId: edge?.toItemVersionId ?? null,
      };
    }),
  };
}
