import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getGoogleDocsAccessToken } from "../server/lib/google-docs-oauth.js";
import { importPptxBufferToDeck } from "./import-pptx.js";

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
        "Connect Google Docs before importing a Google Slides deck.",
      );
    }

    const presentationId = extractGoogleSlidesPresentationId(
      presentationUrl ?? fileId ?? "",
    );
    const fileBuffer = await exportGoogleSlidesAsPptx(
      presentationId,
      connection.accessToken,
    );
    return importPptxBufferToDeck({
      fileBuffer,
      title,
      source: "import-google-slides-reference",
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
