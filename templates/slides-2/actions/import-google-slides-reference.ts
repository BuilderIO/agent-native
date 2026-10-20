import { defineAction, fail } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import pLimit from "p-limit";
import { z } from "zod";

import {
  parsePptx,
  type ParsedPresentation,
} from "../server/handlers/import/pptx-parser.js";
import { getAvailableGoogleDocsAccessToken } from "../server/lib/google-docs-access.js";
import { trackDeckCreated } from "./_deck-tracking.js";
import {
  importPptxBufferToDeck,
  type ImportedImageFallback,
} from "./import-pptx.js";

const MAX_GOOGLE_SLIDES_PPTX_BYTES = 100 * 1024 * 1024;
const MAX_GOOGLE_SLIDES_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_GOOGLE_SLIDES_IMAGE_CANDIDATES = 500;
const MAX_GOOGLE_SLIDES_IMAGE_FETCHES = 250;
const MAX_GOOGLE_SLIDES_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GOOGLE_SLIDES_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

type ResponseSizeFailure = {
  errorCode: string;
  message: string;
};

type ResponseReaderRegistration = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
) => () => void;

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    console.warn("[slides-2] Failed to cancel rejected response body");
  }
}

async function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    console.warn("[slides-2] Failed to cancel rejected response reader");
  }
}

async function cancelResponseStream(
  stream: ReadableStream<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  if (stream.locked) return;
  try {
    await stream.cancel(reason);
  } catch {
    console.warn("[slides-2] Failed to cancel rejected response stream");
  }
}

export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  failure: ResponseSizeFailure,
  acceptChunk?: (byteCount: number) => ResponseSizeFailure | null,
  registerReader?: ResponseReaderRegistration,
): Promise<Buffer> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    await cancelResponseBody(response);
    fail(failure.message, { errorCode: failure.errorCode, statusCode: 413 });
  }

  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let size = 0;
  let unregisterReader: (() => void) | undefined;
  try {
    unregisterReader = registerReader?.(reader);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      const chunkFailure = acceptChunk?.(value.byteLength);
      const sizeFailure = size > maxBytes ? failure : chunkFailure;
      if (sizeFailure) {
        await cancelResponseReader(reader);
        fail(sizeFailure.message, {
          errorCode: sizeFailure.errorCode,
          statusCode: 413,
        });
      }
      chunks.push(value);
    }
  } finally {
    unregisterReader?.();
    reader.releaseLock();
  }

  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides-2",
    view: "editor",
    params: { deckId },
  });
}

function invalidSlidesReference(message: string): never {
  return fail(message, {
    errorCode: "invalid_google_slides_reference",
    statusCode: 400,
  });
}

export function extractGoogleSlidesPresentationId(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    invalidSlidesReference("A Google Slides file ID or URL is required.");
  }

  if (!/^https?:\/\//i.test(candidate)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(candidate)) {
      invalidSlidesReference(
        "Use a Google Slides file ID or a docs.google.com presentation URL.",
      );
    }
    return candidate;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    invalidSlidesReference("Use a valid Google Slides presentation URL.");
  }
  if (url.hostname !== "docs.google.com") {
    invalidSlidesReference(
      "Use a docs.google.com Google Slides presentation URL.",
    );
  }
  const match = url.pathname.match(
    /^\/presentation\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/|$)/,
  );
  if (!match) {
    invalidSlidesReference(
      "That URL is not a Google Slides presentation link.",
    );
  }
  return match[1];
}

async function exportGoogleSlidesAsPptx(fileId: string, accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    await cancelResponseBody(response);
    throw googleSlidesExportError(response.status);
  }

  const bytes = await readBoundedResponseBytes(
    response,
    MAX_GOOGLE_SLIDES_PPTX_BYTES,
    {
      errorCode: "google_slides_export_too_large",
      message: "Google Drive returned an export that is too large to import.",
    },
  );
  if (bytes.byteLength === 0) {
    fail("Google Drive returned an empty presentation export.", {
      errorCode: "google_slides_export_empty",
      statusCode: 502,
    });
  }

  return bytes;
}

interface GoogleSlidesImageElement {
  objectId?: string;
  size?: {
    width?: { magnitude?: number; unit?: string };
    height?: { magnitude?: number; unit?: string };
  };
  transform?: {
    scaleX?: number;
    scaleY?: number;
    translateX?: number;
    translateY?: number;
    unit?: string;
  };
  image?: {
    contentUrl?: string;
    imageProperties?: {
      cropProperties?: {
        leftOffset?: number;
        rightOffset?: number;
        topOffset?: number;
        bottomOffset?: number;
      };
    };
  };
}

interface GoogleSlidesPresentationImages {
  slides?: Array<{
    pageElements?: GoogleSlidesImageElement[];
  }>;
}

interface GoogleSlidesImageCandidate {
  slideIndex: number;
  imageIndex: number;
  objectId?: string;
  contentUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: ImportedImageFallback["crop"];
}

function finiteNumber(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined;
}

const EMU_PER_POINT = 12700;

export function googleSlidesMeasurementToEmu(
  value: number | undefined,
  unit?: string,
): number | undefined {
  const finite = finiteNumber(value);
  if (finite == null) return undefined;
  return unit === "PT" ? finite * EMU_PER_POINT : finite;
}

export function googleSlidesExportError(
  status: number,
): Error & { statusCode?: number } {
  if (status === 401) {
    return Object.assign(
      new Error(
        "Google Drive connection expired. Connect Google again, then retry the import.",
      ),
      { statusCode: 401 },
    );
  }
  if (status === 403) {
    return Object.assign(
      new Error(
        "Google Drive denied access to this presentation. Connect Google again to enable pasted-link imports, or choose the deck through Google Picker.",
      ),
      { statusCode: 403 },
    );
  }
  return new Error(
    `Google Drive returned HTTP ${status} while exporting the presentation.`,
  );
}

async function fetchGoogleSlidesImageFallbacks(
  fileId: string,
  accessToken: string,
  presentation: ParsedPresentation,
): Promise<ImportedImageFallback[]> {
  const fields =
    "slides(pageElements(objectId,size(width(magnitude,unit),height(magnitude,unit)),transform(scaleX,scaleY,translateX,translateY,unit),image(contentUrl,imageProperties(cropProperties))))";
  const response = await ssrfSafeFetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { httpsOnly: true, maxRedirects: 2 },
  );
  if (!response.ok) {
    await cancelResponseBody(response);
    fail(
      `Google Slides returned HTTP ${response.status} while reading native image elements. Reconnect Google Drive and try the import again.`,
      { errorCode: "google_slides_images_request_failed", statusCode: 502 },
    );
  }
  const metadataBytes = await readBoundedResponseBytes(
    response,
    MAX_GOOGLE_SLIDES_METADATA_BYTES,
    {
      errorCode: "google_slides_images_response_too_large",
      message: "Google Slides returned too much image metadata to import.",
    },
  );
  let googlePresentation: GoogleSlidesPresentationImages;
  try {
    googlePresentation = JSON.parse(
      metadataBytes.toString("utf8"),
    ) as GoogleSlidesPresentationImages;
  } catch {
    fail("Google Slides returned invalid image metadata.", {
      errorCode: "google_slides_images_response_invalid",
      statusCode: 502,
    });
  }
  const candidates: GoogleSlidesImageCandidate[] = [];
  const candidateKeys = new Set<string>();
  const imageFetchUrls = new Set<string>();

  for (const [slideIndex, slide] of (
    googlePresentation.slides ?? []
  ).entries()) {
    for (const [imageIndex, element] of (slide.pageElements ?? []).entries()) {
      const contentUrl = element.image?.contentUrl;
      const baseWidth = googleSlidesMeasurementToEmu(
        element.size?.width?.magnitude,
        element.size?.width?.unit,
      );
      const baseHeight = googleSlidesMeasurementToEmu(
        element.size?.height?.magnitude,
        element.size?.height?.unit,
      );
      const scaleX = finiteNumber(element.transform?.scaleX) ?? 1;
      const scaleY = finiteNumber(element.transform?.scaleY) ?? 1;
      const x = googleSlidesMeasurementToEmu(
        element.transform?.translateX,
        element.transform?.unit,
      );
      const y = googleSlidesMeasurementToEmu(
        element.transform?.translateY,
        element.transform?.unit,
      );
      const width =
        baseWidth == null ? undefined : baseWidth * Math.abs(scaleX);
      const height =
        baseHeight == null ? undefined : baseHeight * Math.abs(scaleY);
      if (
        !contentUrl ||
        x == null ||
        y == null ||
        width == null ||
        height == null ||
        width <= 0 ||
        height <= 0
      ) {
        continue;
      }

      const existingImage = presentation.slides[slideIndex]?.elements.some(
        (existing) =>
          existing.kind === "image" &&
          Math.abs(existing.x - x) < 1000 &&
          Math.abs(existing.y - y) < 1000 &&
          Math.abs(existing.width - width) < 1000 &&
          Math.abs(existing.height - height) < 1000,
      );
      if (existingImage) continue;

      const cropProperties = element.image?.imageProperties?.cropProperties;
      const crop = cropProperties
        ? {
            left: cropProperties.leftOffset ?? 0,
            top: cropProperties.topOffset ?? 0,
            right: cropProperties.rightOffset ?? 0,
            bottom: cropProperties.bottomOffset ?? 0,
          }
        : undefined;
      const candidateKey = `${slideIndex}:${x}:${y}:${width}:${height}`;
      if (candidateKeys.has(candidateKey)) continue;
      if (candidates.length >= MAX_GOOGLE_SLIDES_IMAGE_CANDIDATES) {
        fail("Google Slides has too many image placements to import.", {
          errorCode: "google_slides_too_many_image_candidates",
          statusCode: 413,
        });
      }
      if (
        !imageFetchUrls.has(contentUrl) &&
        imageFetchUrls.size >= MAX_GOOGLE_SLIDES_IMAGE_FETCHES
      ) {
        fail("Google Slides has too many distinct images to import.", {
          errorCode: "google_slides_too_many_image_fetches",
          statusCode: 413,
        });
      }
      candidateKeys.add(candidateKey);
      imageFetchUrls.add(contentUrl);
      candidates.push({
        slideIndex,
        imageIndex,
        ...(element.objectId ? { objectId: element.objectId } : {}),
        contentUrl,
        x,
        y,
        width,
        height,
        ...(crop ? { crop } : {}),
      });
    }
  }

  const downloadLimit = pLimit(4);
  const imageDownloads = new Map<
    string,
    Promise<{ data: Uint8Array; mimeType: string }>
  >();
  const imageDownloadController = new AbortController();
  const activeImageBodies = new Set<ReadableStream<Uint8Array>>();
  const activeImageReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let hasImageDownloadFailure = false;
  let firstImageDownloadFailure: unknown;
  let cancellationPromise = Promise.resolve();
  const queueCleanup = (cleanup: Promise<void>) => {
    cancellationPromise = Promise.all([cancellationPromise, cleanup]).then(
      () => undefined,
    );
  };
  const registerImageResponse = (response: Response) => {
    const body = response.body;
    if (!body) return () => {};
    if (hasImageDownloadFailure) {
      queueCleanup(cancelResponseStream(body, firstImageDownloadFailure));
    } else {
      activeImageBodies.add(body);
    }
    return () => activeImageBodies.delete(body);
  };
  const registerImageReader: ResponseReaderRegistration = (reader) => {
    if (hasImageDownloadFailure) {
      queueCleanup(cancelResponseReader(reader, firstImageDownloadFailure));
    } else {
      activeImageReaders.add(reader);
    }
    return () => activeImageReaders.delete(reader);
  };
  const stopImageDownloads = (error: unknown) => {
    if (!hasImageDownloadFailure) {
      hasImageDownloadFailure = true;
      firstImageDownloadFailure = error;
      imageDownloadController.abort(error);
      for (const reader of activeImageReaders) {
        queueCleanup(cancelResponseReader(reader, error));
      }
      for (const body of activeImageBodies) {
        queueCleanup(cancelResponseStream(body, error));
      }
    }
    return firstImageDownloadFailure;
  };
  let totalImageBytes = 0;
  const downloadImage = (candidate: GoogleSlidesImageCandidate) => {
    const existing = imageDownloads.get(candidate.contentUrl);
    if (existing) return existing;

    const download = downloadLimit(async () => {
      if (hasImageDownloadFailure) throw firstImageDownloadFailure;

      let releaseImageResponse = () => {};
      try {
        const imageResponse = await ssrfSafeFetch(
          candidate.contentUrl,
          { signal: imageDownloadController.signal },
          { httpsOnly: true, maxRedirects: 2 },
        );
        releaseImageResponse = registerImageResponse(imageResponse);
        if (hasImageDownloadFailure) throw firstImageDownloadFailure;
        if (!imageResponse.ok) {
          await cancelResponseBody(imageResponse);
          fail(
            `Google Slides returned HTTP ${imageResponse.status} while downloading image ${candidate.imageIndex + 1} on slide ${candidate.slideIndex + 1}.`,
            {
              errorCode: "google_slides_image_download_failed",
              statusCode: 502,
            },
          );
        }
        const mimeType =
          imageResponse.headers.get("content-type")?.split(";", 1)[0] ||
          "image/png";
        if (!mimeType.startsWith("image/")) {
          await cancelResponseBody(imageResponse);
          fail(
            `Google Slides returned a non-image asset for image ${candidate.imageIndex + 1} on slide ${candidate.slideIndex + 1}.`,
            { errorCode: "google_slides_image_invalid", statusCode: 502 },
          );
        }
        const data = await readBoundedResponseBytes(
          imageResponse,
          MAX_GOOGLE_SLIDES_IMAGE_BYTES,
          {
            errorCode: "google_slides_image_too_large",
            message: `Google Slides image ${candidate.imageIndex + 1} on slide ${candidate.slideIndex + 1} exceeds the import size limit.`,
          },
          (byteCount) => {
            if (
              totalImageBytes + byteCount >
              MAX_GOOGLE_SLIDES_TOTAL_IMAGE_BYTES
            ) {
              return {
                errorCode: "google_slides_images_too_large",
                message:
                  "Google Slides images exceed the total import size limit.",
              };
            }
            totalImageBytes += byteCount;
            return null;
          },
          registerImageReader,
        );
        if (data.byteLength === 0) {
          fail(
            `Google Slides returned an empty image for image ${candidate.imageIndex + 1} on slide ${candidate.slideIndex + 1}.`,
            { errorCode: "google_slides_image_empty", statusCode: 502 },
          );
        }
        return { data, mimeType };
      } catch (error) {
        const failure = stopImageDownloads(error);
        await cancellationPromise;
        throw failure;
      } finally {
        releaseImageResponse();
      }
    });
    imageDownloads.set(candidate.contentUrl, download);
    return download;
  };

  const results = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const { data, mimeType } = await downloadImage(candidate);
      return {
        slideIndex: candidate.slideIndex,
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        data,
        mimeType,
        name: `google-slides-${candidate.slideIndex + 1}-${candidate.objectId ?? candidate.imageIndex}.png`,
        ...(candidate.crop ? { crop: candidate.crop } : {}),
      };
    }),
  );
  if (hasImageDownloadFailure) throw firstImageDownloadFailure;
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

export default defineAction({
  description:
    "Import a Google Slides deck selected from Google Picker or provided as a Google Slides URL and save it as a reusable Slides reference deck. " +
    "The selected presentation is exported from Drive as PPTX, parsed, and stored as a normal deck in the caller's Slides workspace.",
  schema: z
    .object({
      fileId: z
        .string()
        .optional()
        .describe("Google Slides file ID from Google Picker"),
      presentationUrl: z
        .string()
        .url()
        .optional()
        .describe("A docs.google.com Google Slides presentation URL"),
      title: z
        .string()
        .optional()
        .describe("Optional title for the imported reference deck"),
      purpose: z
        .enum(["direct", "reference"])
        .optional()
        .describe("Why the deck is being imported; used only for analytics"),
    })
    .refine(
      ({ fileId, presentationUrl }) => Boolean(fileId || presentationUrl),
      {
        message: "Provide either fileId or presentationUrl.",
      },
    ),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ fileId, presentationUrl, title, purpose }, ctx) => {
    const owner = getRequestUserEmail();
    if (!owner)
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });

    const connection = await getAvailableGoogleDocsAccessToken(
      owner,
      presentationUrl ? { requireDriveExportScope: true } : undefined,
    );
    if (!connection) {
      fail(
        "Google Drive is not connected. Use the Connect Google button in Slides, then try again.",
        {
          errorCode: "google_drive_not_connected",
          statusCode: 412,
        },
      );
    }

    const presentationId = extractGoogleSlidesPresentationId(
      presentationUrl ?? fileId ?? "",
    );
    const fileBuffer = await exportGoogleSlidesAsPptx(
      presentationId,
      connection.accessToken,
    );
    const parsedPresentation = await parsePptx(fileBuffer, {
      includeHiddenSlides: true,
    });
    const imageFallbacks = await fetchGoogleSlidesImageFallbacks(
      presentationId,
      connection.accessToken,
      parsedPresentation,
    );
    const result = await importPptxBufferToDeck({
      fileBuffer,
      parsedPresentation,
      title,
      source: "import-google-slides-reference",
      imageFallbacks,
    });
    trackDeckCreated(
      result.id,
      {
        creationMethod: "import_gslides",
        purpose: purpose ?? "unknown",
        slideCount: result.slideCount,
      },
      ctx,
    );
    return result;
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides 2",
      view: "editor",
    };
  },
});
