import { defineAction } from "@agent-native/core";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import pLimit from "p-limit";
import { z } from "zod";

import {
  parsePptx,
  type ParsedPresentation,
} from "../server/handlers/import/pptx-parser.js";
import { getGoogleDocsAccessToken } from "../server/lib/google-docs-oauth.js";
import {
  importPptxBufferToDeck,
  type ImportedImageFallback,
} from "./import-pptx.js";

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

export function extractGoogleSlidesPresentationId(value: string): string {
  const candidate = value.trim();
  if (!candidate)
    throw new Error("A Google Slides file ID or URL is required.");

  if (!/^https?:\/\//i.test(candidate)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(candidate)) {
      throw new Error(
        "Use a Google Slides file ID or a docs.google.com presentation URL.",
      );
    }
    return candidate;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Use a valid Google Slides presentation URL.");
  }
  if (url.hostname !== "docs.google.com") {
    throw new Error("Use a docs.google.com Google Slides presentation URL.");
  }
  const match = url.pathname.match(
    /^\/presentation\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/,
  );
  if (!match) {
    throw new Error("That URL is not a Google Slides presentation link.");
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
    throw new Error(
      `Google Drive returned HTTP ${response.status} while exporting the presentation.`,
    );
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Google Drive returned an empty presentation export.");
  }

  return Buffer.from(bytes);
}

interface GoogleSlidesImageElement {
  objectId?: string;
  size?: {
    width?: { magnitude?: number };
    height?: { magnitude?: number };
  };
  transform?: {
    scaleX?: number;
    scaleY?: number;
    translateX?: number;
    translateY?: number;
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

/**
 * Google Drive's PPTX export can omit image page elements that remain present
 * in the native Slides document. Read those native objects as a fidelity
 * fallback so a direct Google Slides import does not silently lose artwork.
 */
async function fetchGoogleSlidesImageFallbacks(
  fileId: string,
  accessToken: string,
  presentation: ParsedPresentation,
): Promise<ImportedImageFallback[]> {
  const fields =
    "slides(pageElements(objectId,size,transform,image(contentUrl,imageProperties(cropProperties))))";
  const response = await ssrfSafeFetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { httpsOnly: true, maxRedirects: 2 },
  );
  if (!response.ok) {
    throw new Error(
      `Google Slides returned HTTP ${response.status} while reading native image elements. Reconnect Google Drive and try the import again.`,
    );
  }
  const googlePresentation =
    (await response.json()) as GoogleSlidesPresentationImages;
  const candidates: GoogleSlidesImageCandidate[] = [];
  const candidateKeys = new Set<string>();

  for (const [slideIndex, slide] of (
    googlePresentation.slides ?? []
  ).entries()) {
    for (const [imageIndex, element] of (slide.pageElements ?? []).entries()) {
      const contentUrl = element.image?.contentUrl;
      const baseWidth = finiteNumber(element.size?.width?.magnitude);
      const baseHeight = finiteNumber(element.size?.height?.magnitude);
      const scaleX = finiteNumber(element.transform?.scaleX) ?? 1;
      const scaleY = finiteNumber(element.transform?.scaleY) ?? 1;
      const x = finiteNumber(element.transform?.translateX);
      const y = finiteNumber(element.transform?.translateY);
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
      candidateKeys.add(candidateKey);
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
  const downloadImage = (candidate: GoogleSlidesImageCandidate) => {
    const existing = imageDownloads.get(candidate.contentUrl);
    if (existing) return existing;

    const download = downloadLimit(async () => {
      const imageResponse = await ssrfSafeFetch(
        candidate.contentUrl,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        { httpsOnly: true, maxRedirects: 2 },
      );
      if (!imageResponse.ok) {
        throw new Error(
          `Google Slides returned HTTP ${imageResponse.status} while downloading image ${candidate.imageIndex + 1} on slide ${candidate.slideIndex + 1}.`,
        );
      }
      const mimeType =
        imageResponse.headers.get("content-type")?.split(";", 1)[0] ||
        "image/png";
      if (!mimeType.startsWith("image/")) {
        throw new Error(
          `Google Slides returned a non-image asset for image ${candidate.imageIndex + 1} on slide ${candidate.slideIndex + 1}.`,
        );
      }
      return {
        data: new Uint8Array(await imageResponse.arrayBuffer()),
        mimeType,
      };
    });
    imageDownloads.set(candidate.contentUrl, download);
    return download;
  };

  return Promise.all(
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
    })
    .refine(
      ({ fileId, presentationUrl }) => Boolean(fileId || presentationUrl),
      {
        message: "Provide either fileId or presentationUrl.",
      },
    ),
  run: async ({ fileId, presentationUrl, title }) => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");

    const connection = await getGoogleDocsAccessToken(owner);
    if (!connection) {
      throw new Error(
        "Google Drive is not connected. Use the Connect Google button in Slides, then try again.",
      );
    }

    const presentationId = extractGoogleSlidesPresentationId(
      presentationUrl ?? fileId ?? "",
    );
    const fileBuffer = await exportGoogleSlidesAsPptx(
      presentationId,
      connection.accessToken,
    );
    const parsedPresentation = await parsePptx(fileBuffer);
    const imageFallbacks = await fetchGoogleSlidesImageFallbacks(
      presentationId,
      connection.accessToken,
      parsedPresentation,
    );
    return importPptxBufferToDeck({
      fileBuffer,
      parsedPresentation,
      title,
      source: "import-google-slides-reference",
      imageFallbacks,
    });
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : undefined;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
