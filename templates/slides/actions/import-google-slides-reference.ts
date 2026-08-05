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
    "Import a Google Slides deck selected from Google Picker and save it as a reusable Slides reference deck. " +
    "The selected presentation is exported from Drive as PPTX, parsed, and stored as a normal deck in the caller's Slides workspace.",
  schema: z.object({
    fileId: z.string().describe("Google Slides file ID from Google Picker"),
    title: z
      .string()
      .optional()
      .describe("Optional title for the imported reference deck"),
  }),
  run: async ({ fileId, title }) => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");

    const connection = await getGoogleDocsAccessToken(owner);
    if (!connection) {
      throw new Error(
        "Connect Google Docs before importing a Google Slides deck.",
      );
    }

    const fileBuffer = await exportGoogleSlidesAsPptx(
      fileId,
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
