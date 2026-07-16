import { createHash } from "node:crypto";

import { cropImageRegion } from "@agent-native/core/ingestion";

import { creativeContextMediaUrl } from "../media-url.js";
import type { ContextMediaInput, NormalizedContextItem } from "../types.js";
import {
  compileGoogleSlidesPresentation,
  type CompiledGoogleSlide,
  type SlidesNativeBounds,
} from "./google-slides-native.js";
import { collectProviderText, normalizeContextItem } from "./normalize.js";
import {
  fetchRemoteArtifact,
  rehostRemoteMedia,
  storePrivateArtifact,
} from "./private-artifacts.js";
import {
  asRecord,
  connectorConnectionId,
  cursorOffset,
  executeConnectorProviderRequest,
  isContextConnectorQuotaError,
  positiveLimit,
  stringArray,
  stringValue,
} from "./provider-response.js";
import type {
  ContextConnectorExecutionContext,
  ContextConnectorFetchRequest,
  ContextConnectorFetchResult,
  ContextConnectorInventoryItem,
  ContextConnectorInventoryPage,
  ContextConnectorInventoryRequest,
  ContextImportConnector,
} from "./types.js";

const SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";
export const GOOGLE_SLIDES_CONTEXT_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/presentations.readonly",
] as const;

export class GoogleSlidesContextConnector implements ContextImportConnector {
  readonly kind = "google-slides" as const;
  readonly label = "Google Slides";
  readonly supportsIncremental = true;

  verifiesContainerOwner(input: {
    config: Record<string, unknown>;
    inventory: ContextConnectorInventoryItem[];
  }): boolean {
    const selectedIds = [...new Set(stringArray(input.config.presentationIds))];
    if (
      selectedIds.length === 0 ||
      input.inventory.length !== selectedIds.length
    ) {
      return false;
    }
    const inventoryById = new Map(
      input.inventory.map((item) => [item.externalId, item]),
    );
    return selectedIds.every((externalId) => {
      const metadata = asRecord(inventoryById.get(externalId)?.metadata);
      const accessSignals = asRecord(metadata?.accessSignals);
      return accessSignals?.ownedByMe === true;
    });
  }

  async inventory(
    request: ContextConnectorInventoryRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage> {
    const connectionId = await connectorConnectionId(
      "google_drive",
      request.config,
      context.resolveConnection,
    );
    const limit = positiveLimit(request.limit, 100, 1_000);
    const presentationIds = stringArray(request.config.presentationIds);
    if (presentationIds.length > 0) {
      const offset = cursorOffset(request.cursor);
      const selected = presentationIds.slice(offset, offset + limit);
      const items = (
        await Promise.all(
          selected.map(async (presentationId) => {
            const file = asRecord(
              await executeConnectorProviderRequest(context.providerApi, {
                provider: "google_drive",
                method: "GET",
                path: `/files/${encodeURIComponent(presentationId)}`,
                query: {
                  fields:
                    "id,name,mimeType,modifiedTime,webViewLink,size,parents,driveId,ownedByMe,shared,copyRequiresWriterPermission,capabilities(canCopy,canDownload,canShare),permissions(type,role,allowFileDiscovery,deleted,pendingOwner)",
                },
                connectionId,
                accountId: stringValue(request.config.accountId),
              }),
            );
            return file ? googleDriveFileInventoryItem(file) : null;
          }),
        )
      ).filter((item): item is NonNullable<typeof item> => item !== null);
      const nextOffset = offset + selected.length;
      const nextCursor =
        nextOffset < presentationIds.length ? String(nextOffset) : null;
      return {
        items,
        nextCursor,
        complete: !nextCursor,
        coverage: {
          inspected: selected.length,
          returned: items.length,
          truncated: Boolean(nextCursor),
        },
      };
    }
    const folderId =
      stringValue(request.config.folderId) ??
      googleDriveContainerIdFromUrl(request.config.folderUrl, "folder");
    const sharedDriveId =
      stringValue(request.config.sharedDriveId) ??
      googleDriveContainerIdFromUrl(
        request.config.sharedDriveUrl,
        "shared drive",
      );
    if (!folderId && !sharedDriveId) {
      throw new Error(
        "Google Slides connector config requires presentationIds, folderId, or sharedDriveId. Recent-file suggestions are not an import boundary until confirmed as presentationIds.",
      );
    }
    const q = [
      `mimeType = '${SLIDES_MIME_TYPE}'`,
      "trashed = false",
      ...(folderId ? [`'${escapeDriveQuery(folderId)}' in parents`] : []),
    ].join(" and ");
    const payload = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "google_drive",
        method: "GET",
        path: "/files",
        query: {
          q,
          pageSize: Math.min(limit, 1_000),
          ...(request.cursor ? { pageToken: request.cursor } : {}),
          fields:
            "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size,parents,driveId,ownedByMe,shared,copyRequiresWriterPermission,capabilities(canCopy,canDownload,canShare),permissions(type,role,allowFileDiscovery,deleted,pendingOwner))",
          orderBy: "modifiedTime desc",
          ...(sharedDriveId
            ? {
                corpora: "drive",
                driveId: sharedDriveId,
                includeItemsFromAllDrives: true,
                supportsAllDrives: true,
              }
            : {}),
        },
        connectionId,
        accountId: stringValue(request.config.accountId),
      }),
    );
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const items = files.flatMap((value) => {
      const file = asRecord(value);
      const id = stringValue(file?.id);
      if (!file || !id) return [];
      const item = googleDriveFileInventoryItem(file);
      return item ? [item] : [];
    });
    const nextCursor = stringValue(payload?.nextPageToken) ?? null;
    return {
      items,
      nextCursor,
      complete: !nextCursor,
      coverage: {
        inspected: files.length,
        returned: items.length,
        truncated: Boolean(nextCursor),
      },
    };
  }

  async fetch(
    request: ContextConnectorFetchRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult> {
    const connectionId = await connectorConnectionId(
      "google_drive",
      request.config,
      context.resolveConnection,
    );
    if (!connectionId) {
      throw new Error(
        "Google Slides imports require a granted Google Drive workspace connection.",
      );
    }
    const presentation = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "google_slides",
        method: "GET",
        path: `/presentations/${encodeURIComponent(request.item.externalId)}`,
        query: {
          fields:
            "presentationId,title,locale,revisionId,pageSize,slides,masters,layouts,notesMaster",
        },
        connectionId,
        accountId: stringValue(request.config.accountId),
        maxBytes: 4 * 1024 * 1024,
      }),
    );
    if (!presentation) {
      throw new Error(
        `Google Slides presentation ${request.item.externalId} returned no data.`,
      );
    }
    const pageSize = asRecord(presentation.pageSize);
    const pageWidth = googleDimensionToPx(asRecord(pageSize?.width)) || 960;
    const pageHeight = googleDimensionToPx(asRecord(pageSize?.height)) || 540;
    const thumbnailCache = new Map<
      string,
      Promise<{
        data: Uint8Array;
        width: number;
        height: number;
      } | null>
    >();
    const revisionId = stringValue(presentation.revisionId);
    const sourceVersion =
      revisionId ??
      request.item.sourceModifiedAt ??
      `snapshot-${createHash("sha256")
        .update(JSON.stringify(presentation))
        .digest("hex")
        .slice(0, 24)}`;
    const assetCache = new Map<string, Promise<ContextMediaInput>>();
    const compiledSlides = await compileGoogleSlidesPresentation(presentation, {
      presentationId: request.item.externalId,
      revisionId: sourceVersion,
      resolveAsset: async (asset) => {
        let pending = assetCache.get(asset.sourceUrl);
        if (!pending) {
          pending = rehostRemoteMedia({
            url: asset.sourceUrl,
            provenanceUrl: asset.provenanceUrl,
            filename: `${safeFilePart(asset.presentationId)}-${createHash("sha256").update(asset.sourceUrl).digest("hex").slice(0, 16)}.png`,
            kind: "image",
            context,
            metadata: {
              provider: "google-slides",
              presentationId: asset.presentationId,
              sourceKind: asset.kind,
            },
          });
          assetCache.set(asset.sourceUrl, pending);
        }
        const media = await pending;
        return mediaWithNativeUrl(
          {
            ...media,
            metadata: {
              ...media.metadata,
              slideObjectId: asset.slideObjectId,
              elementObjectId: asset.elementObjectId,
            },
          },
          asset,
          sourceVersion,
        );
      },
      resolveFallback: async (fallback) => {
        try {
          let pending = thumbnailCache.get(fallback.slideObjectId);
          if (!pending) {
            pending = fetchTemporarySlideRender({
              presentationId: fallback.presentationId,
              slideObjectId: fallback.slideObjectId,
              config: request.config,
              connectionId,
              context,
            });
            thumbnailCache.set(fallback.slideObjectId, pending);
          }
          const source = await pending;
          if (!source) return null;
          const region = thumbnailCropRegion({
            bounds: fallback.bounds,
            pageWidth,
            pageHeight,
            imageWidth: source.width,
            imageHeight: source.height,
          });
          const cropped = await cropImageRegion({
            data: source.data,
            ...region,
          });
          const stored = await storePrivateArtifact({
            data: cropped.data,
            filename: `${safeFilePart(fallback.presentationId)}-${safeFilePart(fallback.slideObjectId)}-${safeFilePart(fallback.elementObjectId)}-fallback.png`,
            mimeType: cropped.mimeType,
            context,
            metadata: {
              kind: "image",
              source: "google-slides-localized-fallback",
            },
          });
          const media: ContextMediaInput = {
            kind: "image",
            mimeType: cropped.mimeType,
            accessMode: "private",
            storageKey: stored.reference,
            contentHash: stored.contentHash,
            width: cropped.width,
            height: cropped.height,
            captionStatus: "not-needed",
            metadata: {
              provider: "google-slides",
              presentationId: fallback.presentationId,
              slideObjectId: fallback.slideObjectId,
              elementObjectId: fallback.elementObjectId,
              localizedFallback: true,
              reason: fallback.reason,
            },
          };
          return mediaWithNativeUrl(media, fallback, sourceVersion);
        } catch (error) {
          if (isContextConnectorQuotaError(error)) throw error;
          return null;
        }
      },
    });
    const items = normalizePresentationSlides(
      presentation,
      request.item,
      compiledSlides,
      sourceVersion,
    );
    const warnings = await hydrateSlideThumbnails({
      presentationId: request.item.externalId,
      items,
      config: request.config,
      connectionId,
      context,
    });
    return {
      items,
      ...(warnings.length ? { warnings } : {}),
    };
  }
}

function googleDriveFileInventoryItem(file: Record<string, unknown>) {
  const id = stringValue(file.id);
  if (!id) return null;
  return {
    externalId: id,
    kind: "google-slides-presentation",
    title: stringValue(file.name) ?? id,
    canonicalUrl:
      stringValue(file.webViewLink) ??
      `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/edit`,
    mimeType: stringValue(file.mimeType) ?? SLIDES_MIME_TYPE,
    sourceModifiedAt: stringValue(file.modifiedTime),
    sizeBytes: finiteNumber(file.size),
    upstreamAccess: googleDriveFileAccess(file),
    metadata: {
      ...(Array.isArray(file.parents) ? { parents: file.parents } : {}),
      accessSignals: googleDriveAccessSignals(file),
    },
  };
}

export function googleSlidesRecommendedPresentationIds(
  config: Record<string, unknown>,
): string[] {
  return stringArray(config.recommendedPresentationIds);
}

function normalizePresentationSlides(
  presentation: Record<string, unknown>,
  inventoryItem: ContextConnectorFetchRequest["item"],
  compiledSlides: CompiledGoogleSlide[],
  sourceVersion: string | undefined,
) {
  const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
  const masters = objectMap(presentation.masters);
  const layouts = objectMap(presentation.layouts);
  const presentationTitle =
    stringValue(presentation.title) ?? inventoryItem.title;
  const revisionId = stringValue(presentation.revisionId);
  const compiledById = new Map(
    compiledSlides.map((compiled) => [compiled.objectId, compiled]),
  );
  const normalizedSlides = slides.flatMap((value, index) => {
    const slide = asRecord(value);
    const objectId = stringValue(slide?.objectId);
    if (!slide || !objectId) return [];
    const properties = asRecord(slide.slideProperties);
    const layout = properties
      ? layouts.get(stringValue(properties.layoutObjectId) ?? "")
      : undefined;
    const layoutProperties = asRecord(layout?.layoutProperties);
    const masterId =
      stringValue(properties?.masterObjectId) ??
      stringValue(layoutProperties?.masterObjectId);
    const master = masters.get(masterId ?? "");
    const compiled = compiledById.get(objectId);
    if (!compiled) return [];
    const body = compiled.plainText;
    const notes = collectProviderText(properties?.notesPage, {
      skipKeys: ["objectId", "elementGroup", "transform", "size"],
    });
    const firstLine = body.split("\n").find(Boolean);
    const title = firstLine
      ? `${presentationTitle} — ${firstLine.slice(0, 120)}`
      : `${presentationTitle} — Slide ${index + 1}`;
    const canonicalBase =
      inventoryItem.canonicalUrl ??
      `https://docs.google.com/presentation/d/${encodeURIComponent(inventoryItem.externalId)}/edit`;
    const childItems = compiled.childArtifacts.map((child, childIndex) =>
      normalizeContextItem({
        externalId: child.externalId,
        kind: "google-slides-native-part",
        title: `${title} — Native part ${childIndex + 1}`,
        canonicalUrl: `${canonicalBase.split("#")[0]}#slide=id.${encodeURIComponent(objectId)}`,
        mimeType: "text/html",
        content: child.html,
        sourceModifiedAt: inventoryItem.sourceModifiedAt,
        sourceVersion,
        parseStatus: "parsed",
        upstreamAccess: inventoryItem.upstreamAccess ?? "unknown",
        curationStatus:
          inventoryItem.upstreamAccess === "restricted" ? "review" : "included",
        provenance: {
          provider: "google-slides",
          presentationId: inventoryItem.externalId,
          slideObjectId: objectId,
          sourceElementObjectId: child.objectId,
          compiler: "@agent-native/creative-context:google-slides-native",
        },
        metadata: {
          provider: "google-slides",
          presentationTitle,
          nativePartOf: `${inventoryItem.externalId}:${objectId}`,
          nativeArtifact: child.nativeArtifact,
        },
        chunks: child.lexicalText
          ? [
              {
                ordinal: 0,
                kind: "slides-native-code",
                text: child.lexicalText,
                metadata: {
                  artifactFormat: "slides-html",
                  includesCodeTokens: true,
                },
              },
            ]
          : [],
        edges: [
          {
            relation: "part-of-native-artifact",
            toExternalId: `${inventoryItem.externalId}:${objectId}`,
          },
        ],
      }),
    );
    const root = normalizeContextItem({
      externalId: `${inventoryItem.externalId}:${objectId}`,
      kind: "google-slides-slide",
      title,
      canonicalUrl: `${canonicalBase.split("#")[0]}#slide=id.${encodeURIComponent(objectId)}`,
      mimeType: "text/html",
      content: compiled.html,
      summary: [
        body.slice(0, 2_000),
        notes ? `Speaker notes: ${notes.slice(0, 500)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      sourceModifiedAt: inventoryItem.sourceModifiedAt,
      sourceVersion,
      parseStatus: "parsed",
      upstreamAccess: inventoryItem.upstreamAccess ?? "unknown",
      curationStatus:
        inventoryItem.upstreamAccess === "restricted" ? "review" : "included",
      provenance: {
        provider: "google-slides",
        presentationId: inventoryItem.externalId,
        slideObjectId: objectId,
        compiler: "@agent-native/creative-context:google-slides-native",
      },
      metadata: {
        provider: "google-slides",
        presentationTitle,
        slideIndex: index,
        slideObjectId: objectId,
        locale: stringValue(presentation.locale),
        revisionId,
        speakerNotes: notes || null,
        theme: inheritedSlideTheme(master, layout, slide),
        nativeArtifact: compiled.nativeArtifact,
      },
      chunks: compiled.lexicalText
        ? [
            {
              ordinal: 0,
              kind: "slides-native-lexical",
              text: [
                compiled.lexicalText,
                notes ? `Speaker notes ${notes}` : "",
              ]
                .filter(Boolean)
                .join("\n")
                .slice(0, 24_000),
              metadata: {
                artifactFormat: "slides-html",
                includesCodeTokens: true,
              },
            },
          ]
        : [],
      media: compiled.media,
      edges: [
        {
          relation: "part-of-presentation",
          toExternalId: inventoryItem.externalId,
        },
        ...compiled.childArtifacts.map((child) => ({
          relation: "contains-native-child",
          toExternalId: child.externalId,
        })),
      ],
    });
    return [root, ...childItems];
  });
  const slideRoots = normalizedSlides.filter(
    (item) => item.kind === "google-slides-slide",
  );
  const parentContent = slideRoots
    .map((item, index) => {
      const excerpt = item.summary?.slice(0, 2_000) ?? "";
      return `Slide ${index + 1}: ${item.title}${excerpt ? `\n${excerpt}` : ""}`;
    })
    .join("\n\n")
    .slice(0, 50_000);
  const parent = normalizeContextItem({
    externalId: inventoryItem.externalId,
    kind: inventoryItem.kind,
    title: presentationTitle,
    canonicalUrl:
      inventoryItem.canonicalUrl ??
      `https://docs.google.com/presentation/d/${encodeURIComponent(inventoryItem.externalId)}/edit`,
    mimeType: inventoryItem.mimeType,
    content: parentContent,
    summary: `${slideRoots.length} indexed slide${slideRoots.length === 1 ? "" : "s"}.`,
    sourceModifiedAt: inventoryItem.sourceModifiedAt,
    sourceVersion,
    parseStatus: "parsed",
    upstreamAccess: inventoryItem.upstreamAccess ?? "unknown",
    curationStatus:
      inventoryItem.upstreamAccess === "restricted" ? "review" : "included",
    provenance: {
      provider: "google-slides",
      presentationId: inventoryItem.externalId,
    },
    metadata: {
      provider: "google-slides",
      presentationTitle,
      slideCount: slideRoots.length,
      locale: stringValue(presentation.locale),
      revisionId,
      childExternalIds: slideRoots.map((item) => item.externalId),
    },
    edges: slideRoots.map((item) => ({
      relation: "contains-slide",
      toExternalId: item.externalId,
    })),
  });
  return [parent, ...normalizedSlides];
}

function mediaWithNativeUrl(
  media: ContextMediaInput,
  source: {
    presentationId: string;
    slideObjectId: string;
    elementObjectId: string;
  },
  revisionId: string | undefined,
): ContextMediaInput & { id: string; url: string } {
  const id = `ccm_${createHash("sha256")
    .update(
      [
        source.presentationId,
        source.slideObjectId,
        source.elementObjectId,
        revisionId ?? "unversioned",
        media.contentHash ?? "unhashed",
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 28)}`;
  return {
    ...media,
    id,
    url: creativeContextMediaUrl({ mediaId: id }),
  };
}

async function fetchTemporarySlideRender(input: {
  presentationId: string;
  slideObjectId: string;
  config: Record<string, unknown>;
  connectionId: string | undefined;
  context: ContextConnectorExecutionContext;
}): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
} | null> {
  const thumbnail = asRecord(
    await executeConnectorProviderRequest(input.context.providerApi, {
      provider: "google_slides",
      method: "GET",
      path: `/presentations/${encodeURIComponent(input.presentationId)}/pages/${encodeURIComponent(input.slideObjectId)}/thumbnail`,
      query: {
        "thumbnailProperties.mimeType": "PNG",
        "thumbnailProperties.thumbnailSize": "LARGE",
      },
      connectionId: input.connectionId,
      accountId: stringValue(input.config.accountId),
    }),
  );
  const contentUrl = stringValue(thumbnail?.contentUrl);
  const width = finiteNumber(thumbnail?.width);
  const height = finiteNumber(thumbnail?.height);
  if (!contentUrl || !width || !height) return null;
  const remote = await fetchRemoteArtifact(contentUrl, input.context);
  return { data: remote.data, width, height };
}

function thumbnailCropRegion(input: {
  bounds: SlidesNativeBounds;
  pageWidth: number;
  pageHeight: number;
  imageWidth: number;
  imageHeight: number;
}): { left: number; top: number; width: number; height: number } {
  const left = Math.max(
    0,
    Math.min(
      input.imageWidth - 1,
      Math.floor((input.bounds.x / input.pageWidth) * input.imageWidth),
    ),
  );
  const top = Math.max(
    0,
    Math.min(
      input.imageHeight - 1,
      Math.floor((input.bounds.y / input.pageHeight) * input.imageHeight),
    ),
  );
  const right = Math.max(
    left + 1,
    Math.min(
      input.imageWidth,
      Math.ceil(
        ((input.bounds.x + input.bounds.width) / input.pageWidth) *
          input.imageWidth,
      ),
    ),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(
      input.imageHeight,
      Math.ceil(
        ((input.bounds.y + input.bounds.height) / input.pageHeight) *
          input.imageHeight,
      ),
    ),
  );
  return { left, top, width: right - left, height: bottom - top };
}

function googleDimensionToPx(value: Record<string, unknown> | null): number {
  if (!value) return 0;
  const magnitude = Number(value.magnitude);
  if (!Number.isFinite(magnitude)) return 0;
  switch ((stringValue(value.unit) ?? "EMU").toUpperCase()) {
    case "PT":
      return (magnitude * 96) / 72;
    case "PX":
      return magnitude;
    case "EMU":
    default:
      return (magnitude * 96) / 914_400;
  }
}

async function hydrateSlideThumbnails(input: {
  presentationId: string;
  items: NormalizedContextItem[];
  config: Record<string, unknown>;
  connectionId: string | undefined;
  context: ContextConnectorExecutionContext;
}): Promise<string[]> {
  if (input.config.hydrateThumbnails === false) return [];
  const candidates = input.items.filter((item) =>
    Boolean(stringValue(item.metadata?.slideObjectId)),
  );
  const limit = Math.min(
    candidates.length,
    positiveLimit(input.config.thumbnailLimit, 15, 50),
  );
  const warnings: string[] = [];
  for (let index = 0; index < limit; index++) {
    const item = candidates[index]!;
    const slideObjectId = stringValue(item.metadata?.slideObjectId);
    if (!slideObjectId) continue;
    try {
      const thumbnail = asRecord(
        await executeConnectorProviderRequest(input.context.providerApi, {
          provider: "google_slides",
          method: "GET",
          path: `/presentations/${encodeURIComponent(input.presentationId)}/pages/${encodeURIComponent(slideObjectId)}/thumbnail`,
          query: {
            "thumbnailProperties.mimeType": "PNG",
            "thumbnailProperties.thumbnailSize": "SMALL",
          },
          connectionId: input.connectionId,
          accountId: stringValue(input.config.accountId),
        }),
      );
      const contentUrl = stringValue(thumbnail?.contentUrl);
      if (!contentUrl) {
        warnings.push(`Slide ${slideObjectId} returned no thumbnail URL.`);
        continue;
      }
      const width = finiteNumber(thumbnail?.width);
      const height = finiteNumber(thumbnail?.height);
      if (!width || !height || width > 400 || height > 400) {
        warnings.push(
          `Slide ${slideObjectId} UI thumbnail exceeded the 400px dimension limit.`,
        );
        continue;
      }
      const remote = await fetchRemoteArtifact(contentUrl, input.context);
      if (remote.data.byteLength > 512 * 1024) {
        warnings.push(
          `Slide ${slideObjectId} UI thumbnail exceeded the 512 KiB storage limit.`,
        );
        continue;
      }
      const stored = await storePrivateArtifact({
        data: remote.data,
        filename: `${safeFilePart(input.presentationId)}-${safeFilePart(slideObjectId)}-ui-thumbnail.png`,
        mimeType: "image/png",
        context: input.context,
        metadata: {
          kind: "image",
          source: "google-slides-bounded-ui-thumbnail",
        },
      });
      const media: ContextMediaInput = {
        kind: "image",
        mimeType: "image/png",
        accessMode: "private",
        storageKey: stored.reference,
        provenanceUrl: item.canonicalUrl,
        contentHash: stored.contentHash,
        ...(stored.palette.length ? { palette: stored.palette } : {}),
        captionStatus: "pending",
        width,
        height,
        metadata: {
          provider: "google-slides",
          presentationId: input.presentationId,
          slideObjectId,
          boundedUiThumbnail: true,
        },
      };
      item.media = [...(item.media ?? []), media];
      item.thumbnailBlobRef = media.storageKey;
    } catch (error) {
      if (isContextConnectorQuotaError(error)) throw error;
      warnings.push(
        `Slide ${slideObjectId} thumbnail was skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return warnings;
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "slide";
}

function inheritedSlideTheme(
  master: Record<string, unknown> | undefined,
  layout: Record<string, unknown> | undefined,
  slide: Record<string, unknown>,
): Record<string, unknown> {
  const merged = deepMerge(
    {},
    asRecord(master?.pageProperties) ?? {},
    asRecord(layout?.pageProperties) ?? {},
    asRecord(slide.pageProperties) ?? {},
  );
  const resolvedTypography = resolveInheritedSlideTypography(
    master,
    layout,
    slide,
  );
  return {
    ...(merged.pageBackgroundFill !== undefined
      ? { pageBackgroundFill: merged.pageBackgroundFill }
      : {}),
    ...(merged.colorScheme !== undefined
      ? { colorScheme: merged.colorScheme }
      : {}),
    masterObjectId: stringValue(master?.objectId) ?? null,
    layoutObjectId: stringValue(layout?.objectId) ?? null,
    fontFamilies: resolvedTypography.fontFamilies,
    fontSizes: resolvedTypography.fontSizes,
    colors: resolvedTypography.colors,
    placeholders: resolvedTypography.placeholders,
    resolvedTextStyles: resolvedTypography.resolvedTextStyles,
  };
}

function resolveInheritedSlideTypography(
  master: Record<string, unknown> | undefined,
  layout: Record<string, unknown> | undefined,
  slide: Record<string, unknown>,
): {
  fontFamilies: string[];
  fontSizes: string[];
  colors: string[];
  placeholders: Array<Record<string, unknown>>;
  resolvedTextStyles: Array<Record<string, unknown>>;
} {
  const masterElements = pageElementMap(master?.pageElements);
  const layoutElements = pageElementMap(layout?.pageElements);
  const slideElements = pageElementMap(slide.pageElements);
  const masterPlaceholders = placeholderElementMap(masterElements);
  const layoutPlaceholders = placeholderElementMap(layoutElements);
  const placeholders: Array<Record<string, unknown>> = [];
  const resolvedTextStyles: Array<Record<string, unknown>> = [];

  for (const element of [...slideElements.values()].slice(0, 200)) {
    const slidePlaceholder = pageElementPlaceholder(element);
    const layoutElement = resolvePlaceholderParent(
      slidePlaceholder,
      layoutElements,
      layoutPlaceholders,
    );
    const layoutPlaceholder = pageElementPlaceholder(layoutElement);
    const masterElement = resolvePlaceholderParent(
      layoutPlaceholder,
      masterElements,
      masterPlaceholders,
    );
    const resolvedStyle = deepMerge(
      {},
      pageElementTextStyle(masterElement),
      pageElementTextStyle(layoutElement),
      pageElementTextStyle(element),
    );
    if (Object.keys(resolvedStyle).length > 0) {
      resolvedTextStyles.push({
        objectId: stringValue(element.objectId) ?? null,
        placeholderType: stringValue(slidePlaceholder?.type) ?? null,
        style: boundedThemeObject(resolvedStyle),
      });
    }
    if (slidePlaceholder) {
      placeholders.push({
        objectId: stringValue(element.objectId) ?? null,
        type: stringValue(slidePlaceholder.type) ?? null,
        index: finiteNumber(slidePlaceholder.index) ?? null,
        layoutObjectId: stringValue(layoutElement?.objectId) ?? null,
        masterObjectId: stringValue(masterElement?.objectId) ?? null,
        inheritedFrom: [
          ...(masterElement ? ["master"] : []),
          ...(layoutElement ? ["layout"] : []),
          "slide",
        ],
        resolvedTextStyle: boundedThemeObject(resolvedStyle),
      });
    }
    if (resolvedTextStyles.length >= 100) break;
  }

  const themeEvidence = {
    placeholders,
    resolvedTextStyles,
    pageProperties: [
      asRecord(master?.pageProperties) ?? {},
      asRecord(layout?.pageProperties) ?? {},
      asRecord(slide.pageProperties) ?? {},
    ],
  };
  return {
    fontFamilies: collectThemeStrings(themeEvidence, "fontFamily", 50),
    fontSizes: collectThemeFontSizes(themeEvidence, 50),
    colors: collectThemeColors(themeEvidence, 100),
    placeholders: placeholders.slice(0, 100),
    resolvedTextStyles: resolvedTextStyles.slice(0, 100),
  };
}

function pageElementMap(value: unknown): Map<string, Record<string, unknown>> {
  const elements = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) return elements;
  for (const entry of value.slice(0, 500)) {
    const element = asRecord(entry);
    const id = stringValue(element?.objectId);
    if (element && id) elements.set(id, element);
  }
  return elements;
}

function placeholderElementMap(
  elements: Map<string, Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const element of elements.values()) {
    const placeholder = pageElementPlaceholder(element);
    const type = stringValue(placeholder?.type);
    if (!type) continue;
    result.set(`${type}:${finiteNumber(placeholder?.index) ?? 0}`, element);
  }
  return result;
}

function resolvePlaceholderParent(
  placeholder: Record<string, unknown> | null,
  elements: Map<string, Record<string, unknown>>,
  placeholders: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (!placeholder) return undefined;
  const parentId = stringValue(placeholder.parentObjectId);
  if (parentId && elements.has(parentId)) return elements.get(parentId);
  const type = stringValue(placeholder.type);
  return type
    ? placeholders.get(`${type}:${finiteNumber(placeholder.index) ?? 0}`)
    : undefined;
}

function pageElementPlaceholder(
  element: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const shape = asRecord(element?.shape);
  return asRecord(shape?.placeholder);
}

function pageElementTextStyle(
  element: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const shape = asRecord(element?.shape);
  const text = asRecord(shape?.text);
  const style = deepMerge({}, asRecord(text?.textStyle) ?? {});
  const textElements = Array.isArray(text?.textElements)
    ? text.textElements.slice(0, 100)
    : [];
  for (const value of textElements) {
    const textElement = asRecord(value);
    const textRun = asRecord(textElement?.textRun);
    const autoText = asRecord(textElement?.autoText);
    const paragraphMarker = asRecord(textElement?.paragraphMarker);
    deepMerge(
      style,
      asRecord(paragraphMarker?.style) ?? {},
      asRecord(textRun?.style) ?? {},
      asRecord(autoText?.style) ?? {},
    );
  }
  return style;
}

function boundedThemeObject(
  value: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth >= 5) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, child]) => [
        key,
        Array.isArray(child)
          ? child.slice(0, 100)
          : asRecord(child)
            ? boundedThemeObject(asRecord(child)!, depth + 1)
            : typeof child === "string"
              ? child.slice(0, 500)
              : child,
      ]),
  );
}

function collectThemeStrings(
  value: unknown,
  key: string,
  limit: number,
): string[] {
  const values = new Set<string>();
  visitTheme(value, (currentKey, currentValue) => {
    if (currentKey !== key) return;
    const text = stringValue(currentValue);
    if (text && values.size < limit) values.add(text);
  });
  return [...values];
}

function collectThemeFontSizes(value: unknown, limit: number): string[] {
  const values = new Set<string>();
  visitTheme(value, (key, currentValue) => {
    if (key !== "fontSize" || values.size >= limit) return;
    const size = asRecord(currentValue);
    const magnitude = finiteNumber(size?.magnitude);
    if (magnitude === undefined) return;
    values.add(`${magnitude}${stringValue(size?.unit) ?? "PT"}`);
  });
  return [...values];
}

function collectThemeColors(value: unknown, limit: number): string[] {
  const values = new Set<string>();
  visitTheme(value, (key, currentValue) => {
    if (values.size >= limit) return;
    if (key === "themeColor") {
      const color = stringValue(currentValue);
      if (color) values.add(`theme:${color}`);
    }
    if (key !== "rgbColor") return;
    const rgb = asRecord(currentValue);
    const channels = [rgb?.red, rgb?.green, rgb?.blue].map(Number);
    if (channels.some((channel) => !Number.isFinite(channel))) return;
    values.add(
      `#${channels
        .map((channel) =>
          Math.round(Math.max(0, Math.min(1, channel)) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`,
    );
  });
  return [...values];
}

function visitTheme(
  value: unknown,
  visit: (key: string, value: unknown) => void,
  depth = 0,
): void {
  if (depth >= 8 || !value) return;
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 200))
      visitTheme(child, visit, depth + 1);
    return;
  }
  const current = asRecord(value);
  if (!current) return;
  for (const [key, child] of Object.entries(current).slice(0, 200)) {
    visit(key, child);
    visitTheme(child, visit, depth + 1);
  }
}

function objectMap(value: unknown): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const record = asRecord(item);
    const id = stringValue(record?.objectId);
    if (record && id) result.set(id, record);
  }
  return result;
}

function deepMerge(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const current = asRecord(target[key]);
      const child = asRecord(value);
      target[key] = child ? deepMerge({ ...(current ?? {}) }, child) : value;
    }
  }
  return target;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function googleDriveFileAccess(
  file: Record<string, unknown>,
): "available" | "restricted" | "unknown" {
  const capabilities = asRecord(file.capabilities);
  const permissions = (Array.isArray(file.permissions) ? file.permissions : [])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  if (
    file.copyRequiresWriterPermission === true ||
    capabilities?.canCopy === false ||
    capabilities?.canDownload === false ||
    permissions.some(
      (permission) =>
        permission.deleted === true ||
        permission.pendingOwner === true ||
        permission.allowFileDiscovery === false,
    )
  ) {
    return "restricted";
  }
  if (
    file.ownedByMe === true ||
    file.shared === true ||
    capabilities?.canCopy === true ||
    capabilities?.canDownload === true
  ) {
    return "available";
  }
  return "unknown";
}

function googleDriveAccessSignals(
  file: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ownedByMe: typeof file.ownedByMe === "boolean" ? file.ownedByMe : null,
    shared: typeof file.shared === "boolean" ? file.shared : null,
    copyRequiresWriterPermission:
      typeof file.copyRequiresWriterPermission === "boolean"
        ? file.copyRequiresWriterPermission
        : null,
    capabilities: asRecord(file.capabilities) ?? null,
    permissions: Array.isArray(file.permissions) ? file.permissions : [],
    driveId: stringValue(file.driveId) ?? null,
  };
}

function googleDriveContainerIdFromUrl(
  value: unknown,
  label: string,
): string | undefined {
  const input = stringValue(value);
  if (!input) return undefined;
  const url = new URL(input);
  if (
    url.hostname !== "drive.google.com" &&
    !url.hostname.endsWith(".drive.google.com")
  ) {
    throw new Error(`Google Drive ${label} URL must use drive.google.com.`);
  }
  const match = url.pathname.match(/\/(?:folders|shared-drives)\/([^/]+)/);
  if (!match?.[1]) {
    throw new Error(`Could not find a ${label} ID in ${input}.`);
  }
  return decodeURIComponent(match[1]);
}
