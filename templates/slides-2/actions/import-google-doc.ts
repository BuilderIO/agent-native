import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { getGoogleDocsAccessToken } from "../server/lib/google-docs-oauth.js";
import {
  extractGoogleDocId,
  normalizeGoogleDocText,
} from "../shared/google-docs.js";

const DEFAULT_MAX_CHARS = 60_000;
const MAX_EXPORT_BYTES = 1_000_000;
const EXPORT_TIMEOUT_MS = 20_000;

class GoogleDocAccessError extends Error {}

async function fetchExportText(
  url: string,
  init?: RequestInit,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await readExportText(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GoogleDocAccessError("Google Docs export timed out.");
    }
    throw error;
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

async function readBoundedExportText(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_EXPORT_BYTES) {
    await response.body?.cancel();
    throw new GoogleDocAccessError(
      "Google returned an export that exceeds the import size limit.",
    );
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EXPORT_BYTES) {
        await reader.cancel();
        throw new GoogleDocAccessError(
          "Google returned an export that exceeds the import size limit.",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readExportText(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new GoogleDocAccessError(
      `Google returned HTTP ${response.status} while exporting the document.`,
    );
  }
  const text = await readBoundedExportText(response);
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
  return fetchExportText(
    `https://www.googleapis.com/drive/v3/files/${documentId}/export?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

async function exportPublicDocument(documentId: string): Promise<string> {
  return fetchExportText(
    `https://docs.google.com/document/d/${documentId}/export?format=txt`,
  );
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
      fail("That does not look like a Google Docs document URL.", {
        errorCode: "invalid_google_doc_url",
        statusCode: 400,
      });
    }

    const limit = maxChars ?? DEFAULT_MAX_CHARS;
    const errors: string[] = [];
    const owner = getRequestUserEmail();
    let userConnection: { accessToken: string; accountEmail: string } | null =
      null;
    // The lookup reads the DB, vault and credential store; its error text is
    // server detail (a driver message can carry the owner's email), never part
    // of the user's "could not read" message.
    let connectionLookupError: unknown;
    if (owner) {
      try {
        userConnection = await getGoogleDocsAccessToken(owner);
      } catch (error) {
        connectionLookupError = error;
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
      // Unreadable only through Google is the user's problem; without the
      // user's own connection checked, it is the server's.
      if (connectionLookupError !== undefined) throw connectionLookupError;
      const shareHint = userConnection
        ? `Choose this document from the Google Docs picker so ${userConnection.accountEmail} grants file access, or set the link to "Anyone with the link can view", then try again.`
        : 'Connect Google Docs and choose the file, set the link to "Anyone with the link can view", or upload an exported .docx file.';
      fail(`Could not read that Google Doc. ${shareHint} ${errors.join(" ")}`, {
        errorCode: "google_doc_unreadable",
        statusCode: 422,
      });
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
