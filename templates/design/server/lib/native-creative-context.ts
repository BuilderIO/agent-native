import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import {
  renderSafeNativeHtmlPreviews,
  serializePrivateBlobHandle,
  type NativeResourceCaptureAdapter,
} from "@agent-native/creative-context/server";
import { and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import { buildDesignSnapshot } from "./design-snapshot.js";

function previewText(value: string, limit = 280) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

async function captureDesignPreviewMedia(input: {
  designId: string;
  ownerEmail: string;
  files: Array<{
    id: string;
    filename: string;
    fileType: string;
    content: string;
  }>;
}) {
  const previewFiles = input.files
    .filter((file) => file.fileType === "html")
    .slice(0, 12);
  const rendered = await renderSafeNativeHtmlPreviews(
    previewFiles.map((file) => ({
      id: file.id,
      html: file.content,
      width: 1_280,
      height: 800,
    })),
  );
  const media = new Map<
    string,
    {
      kind: "image";
      mimeType: "image/png";
      accessMode: "private";
      storageKey: string;
      altText: string;
      contentHash: string;
      width: number;
      height: number;
      metadata: { role: "design-preview"; fileId: string };
    }
  >();
  await Promise.all(
    rendered.map(async (preview) => {
      const contentHash = createHash("sha256")
        .update(preview.data)
        .digest("hex");
      const handle = await putPrivateBlob({
        data: preview.data,
        filename: `${input.designId}-${preview.id}.preview.png`,
        mimeType: "image/png",
        ownerEmail: input.ownerEmail,
        key: `creative-context/design/${input.designId}/previews/${contentHash}.png`,
        metadata: {
          appId: "design",
          resourceType: "design-preview",
          resourceId: input.designId,
          contentHash,
        },
      }).catch(() => null);
      if (!handle) return;
      const file = previewFiles.find(
        (candidate) => candidate.id === preview.id,
      );
      media.set(preview.id, {
        kind: "image",
        mimeType: "image/png",
        accessMode: "private",
        storageKey: serializePrivateBlobHandle(handle),
        altText: file?.filename ?? "Design preview",
        contentHash,
        width: preview.width,
        height: preview.height,
        metadata: { role: "design-preview", fileId: preview.id },
      });
    }),
  );
  return media;
}

export const nativeDesignCreativeContextAdapter: NativeResourceCaptureAdapter =
  {
    appId: "design",
    resourceType: "design",
    async listResourceVersions(resourceIds) {
      if (!resourceIds.length) return [];
      return getDb()
        .select({
          resourceId: schema.designs.id,
          sourceModifiedAt: schema.designs.updatedAt,
        })
        .from(schema.designs)
        .where(
          and(
            inArray(schema.designs.id, [...resourceIds]),
            accessFilter(schema.designs, schema.designShares),
          ),
        );
    },
    async capture(reference) {
      const access = await resolveAccess("design", reference.resourceId);
      if (!access) throw new Error("Design not found");
      const design = access.resource as typeof schema.designs.$inferSelect;
      if (
        reference.expectedUpdatedAt &&
        reference.expectedUpdatedAt !== design.updatedAt
      )
        throw new Error(
          "Design changed before it could be submitted to Context.",
        );
      const snapshot = await buildDesignSnapshot(design.id, design.data);
      const payload = JSON.stringify({
        designId: design.id,
        designData: design.data,
        files: snapshot.files,
        tweaks: snapshot.tweaks,
        appliedTweaks: snapshot.appliedTweaks,
        resolvedCssVars: snapshot.resolvedCssVars,
      });
      const contentHash = createHash("sha256").update(payload).digest("hex");
      const versionId = nanoid();
      await getDb().insert(schema.designVersions).values({
        id: versionId,
        designId: design.id,
        label: "Creative Context submission",
        snapshot: payload,
        createdAt: new Date().toISOString(),
      });
      const handle = await putPrivateBlob({
        data: Buffer.from(payload),
        filename: `${design.id}.design.json`,
        mimeType: "application/json",
        ownerEmail: design.ownerEmail,
        key: `creative-context/design/${design.id}/${contentHash}.json`,
        metadata: {
          appId: "design",
          resourceType: "design",
          resourceId: design.id,
          contentHash,
        },
      });
      if (!handle)
        throw new Error(
          "Private blob storage is required to submit a design to Context.",
        );
      const previewMedia = await captureDesignPreviewMedia({
        designId: design.id,
        ownerEmail: design.ownerEmail,
        files: snapshot.files,
      });
      const sourceModifiedAt = design.updatedAt ?? undefined;
      return {
        artifactKey: `design:design:${design.id}`,
        source: {
          name: "Design",
          kind: "native-app",
          externalRef: design.id,
          access: {
            visibility: design.visibility ?? "private",
            canManage: access.role === "owner" || access.role === "admin",
          },
        },
        items: [
          {
            externalId: `native:design:design:${design.id}`,
            kind: "design-project",
            title: design.title,
            canonicalUrl: `/design/${design.id}`,
            mimeType: "application/json",
            content: snapshot.files
              .map(
                (file) =>
                  `${file.filename}\n${file.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}`,
              )
              .join("\n")
              .slice(0, 40_000),
            summary: `${snapshot.files.length} saved design files captured as an immutable version.`,
            contentHash,
            sourceModifiedAt,
            sourceVersion: versionId,
            metadata: {
              preview: {
                type: "design",
                fileCount: snapshot.files.length,
                frames: snapshot.files.slice(0, 24).map((file) => ({
                  title: file.filename.slice(0, 160),
                  fileType: file.fileType.slice(0, 80),
                  excerpt: previewText(file.content),
                })),
              },
            },
            media: [...previewMedia.values()],
            edges: snapshot.files.map((file) => ({
              relation: "contains",
              toExternalId: `native:design:design:${design.id}:frame:${file.id}`,
            })),
          },
          ...snapshot.files.map((file) => {
            const content = file.content
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            return {
              externalId: `native:design:design:${design.id}:frame:${file.id}`,
              kind: "design-frame",
              title: file.filename,
              canonicalUrl: `/design/${design.id}`,
              mimeType: "text/html",
              content,
              summary: content.slice(0, 500),
              contentHash: createHash("sha256")
                .update(file.content)
                .digest("hex"),
              sourceModifiedAt,
              sourceVersion: versionId,
              metadata: {
                preview: {
                  type: "design-frame",
                  title: file.filename.slice(0, 160),
                  fileType: file.fileType.slice(0, 80),
                  excerpt: previewText(file.content),
                },
              },
              media: previewMedia.has(file.id)
                ? [previewMedia.get(file.id)!]
                : undefined,
            };
          }),
        ],
        privateMetadata: {
          nativeResource: {
            appId: "design",
            resourceType: "design",
            resourceId: design.id,
            expectedUpdatedAt: reference.expectedUpdatedAt,
          },
          clone: {
            handle,
            appId: "design",
            resourceType: "design",
            resourceId: design.id,
            contentHash,
            sourceVersion: versionId,
            updatedAt: design.updatedAt,
          },
        },
      };
    },
  };
