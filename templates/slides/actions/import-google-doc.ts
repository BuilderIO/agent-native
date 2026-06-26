import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { getGoogleDocsAccessToken } from "../server/lib/google-docs-oauth.js";
import {
  extractGoogleDocId,
  normalizeGoogleDocText,
} from "../shared/google-docs.js";

const DEFAULT_MAX_CHARS = 60_000;

class GoogleDocAccessError extends Error {}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isGoogleHtmlAccessPage(text: string, contentType: string | null) {
  const sample = text.slice(0, 2000).toLowerCase();
  return (
    contentType?.toLowerCase().includes("text/html") ||
    sample.includes("<html") ||
    sample.includes("<!doctype html")
  );
}

async function readExportText(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    throw new GoogleDocAccessError(
      `Google returned HTTP ${response.status} while exporting the document.`,
    );
  }
  if (isGoogleHtmlAccessPage(text, response.headers.get("content-type"))) {
    throw new GoogleDocAccessError(
      "Google returned a sign-in or access page instead of document text.",
    );
  }
  const normalized = normalizeGoogleDocText(text);
  if (!normalized) {
    throw new GoogleDocAccessError("Google returned an empty document export.");
  }
  return normalized;
}

async function exportWithDriveToken(
  documentId: string,
  token: string,
): Promise<string> {
  const params = new URLSearchParams({ mimeType: "text/plain" });
  const response = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files/${documentId}/export?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return readExportText(response);
}

async function exportPublicDocument(documentId: string): Promise<string> {
  const response = await fetchWithTimeout(
    `https://docs.google.com/document/d/${documentId}/export?format=txt`,
  );
  return readExportText(response);
}

export default defineAction({
  description:
    "Import plain text from a Google Docs document URL or document ID. " +
    "Works for public Docs links, private Docs selected through the user's " +
    "connected Google Docs account, and Docs set to anyone-with-the-link view.",
  schema: z.object({
    url: z.string().describe("Google Docs URL or raw document ID"),
    maxChars: z.coerce
      .number()
      .int()
      .min(1000)
      .max(100_000)
      .optional()
      .describe("Maximum characters to return (default 60000)"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ url, maxChars }) => {
    const documentId = extractGoogleDocId(url);
    if (!documentId) {
      throw new Error("That does not look like a Google Docs document URL.");
    }

    const limit = maxChars ?? DEFAULT_MAX_CHARS;
    const errors: string[] = [];
    const owner = getRequestUserEmail();
    let userConnection: { accessToken: string; accountEmail: string } | null =
      null;
    if (owner) {
      try {
        userConnection = await getGoogleDocsAccessToken(owner);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    let text: string | null = null;
    let source: "user-oauth" | "public-export" | null = null;

    if (userConnection) {
      try {
        text = await exportWithDriveToken(
          documentId,
          userConnection.accessToken,
        );
        source = "user-oauth";
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!text) {
      try {
        text = await exportPublicDocument(documentId);
        source = "public-export";
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!text || !source) {
      const shareHint = userConnection
        ? `Choose this document from the Google Docs picker so ${userConnection.accountEmail} grants file access, or set the link to "Anyone with the link can view", then try again.`
        : 'Connect Google Docs and choose the file, set the link to "Anyone with the link can view", or upload an exported .docx file.';
      throw new Error(
        `Could not read that Google Doc. ${shareHint} ${errors.join(" ")}`,
      );
    }

    const truncated = text.length > limit;
    return {
      documentId,
      source,
      text: truncated ? text.slice(0, limit) : text,
      charCount: text.length,
      truncated,
      googleAccountEmail: userConnection?.accountEmail,
      note: truncated
        ? `Returned the first ${limit} characters. Ask for a higher maxChars value if more context is needed.`
        : undefined,
    };
  },
});
