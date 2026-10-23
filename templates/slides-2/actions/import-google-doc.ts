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
const MAX_EXPORT_CHARS = 200_000;
const EXPORT_TIMEOUT_MS = 20_000;

class GoogleDocAccessError extends Error {}
class GoogleDocTooLargeError extends Error {}

class GoogleDocResponseCleanupError extends Error {
  readonly errorCode = "google_doc_response_cleanup_failed";

  constructor(
    readonly primaryError: unknown,
    readonly cleanupError: unknown,
  ) {
    super("Could not stop reading the Google Docs export response.");
  }
}

async function cancelGoogleDocResponse(
  response: Response,
  primaryError?: unknown,
) {
  try {
    await response.body?.cancel();
  } catch (cleanupError) {
    throw new GoogleDocResponseCleanupError(primaryError, cleanupError);
  }
}

async function cancelGoogleDocReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  primaryError: unknown,
) {
  try {
    await reader.cancel();
  } catch (cleanupError) {
    throw new GoogleDocResponseCleanupError(primaryError, cleanupError);
  }
}

async function fetchExportTextWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await readExportText(response, controller.signal);
  } catch (error) {
    if (
      controller.signal.aborted &&
      !(error instanceof GoogleDocResponseCleanupError)
    ) {
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

function assertExportSize(size: number, total: number, limit: number) {
  if (size > limit - total) {
    throw new GoogleDocTooLargeError(
      "Google Doc export exceeds the supported size limit.",
    );
  }
}

async function readResponseText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (Number.isSafeInteger(declaredBytes)) {
      try {
        assertExportSize(declaredBytes, 0, MAX_EXPORT_BYTES);
      } catch (error) {
        await cancelGoogleDocResponse(response, error);
        throw error;
      }
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  let rejectOnAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () =>
    rejectOnAbort(
      new GoogleDocAccessError(
        "Google Docs export timed out while reading document text.",
      ),
    );
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let charsRead = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;

      bytesRead += value.byteLength;
      assertExportSize(
        value.byteLength,
        bytesRead - value.byteLength,
        MAX_EXPORT_BYTES,
      );

      const chunk = decoder.decode(value, { stream: true });
      assertExportSize(chunk.length, charsRead, MAX_EXPORT_CHARS);
      charsRead += chunk.length;
      chunks.push(chunk);
    }

    const tail = decoder.decode();
    assertExportSize(tail.length, charsRead, MAX_EXPORT_CHARS);
    chunks.push(tail);
    return chunks.join("");
  } catch (error) {
    if (!signal.aborted) await cancelGoogleDocReader(reader, error);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

async function readExportText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (!response.ok) {
    await cancelGoogleDocResponse(response);
    throw new GoogleDocAccessError(
      `Google returned HTTP ${response.status} while exporting the document.`,
    );
  }
  const text = await readResponseText(response, signal);
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
  return fetchExportTextWithTimeout(
    `https://www.googleapis.com/drive/v3/files/${documentId}/export?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

async function exportPublicDocument(documentId: string): Promise<string> {
  return fetchExportTextWithTimeout(
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
    let exportTooLarge = false;

    if (userConnection) {
      try {
        text = await exportWithDriveToken(
          documentId,
          userConnection.accessToken,
        );
        source = "user-oauth";
      } catch (error) {
        if (error instanceof GoogleDocResponseCleanupError) {
          fail("Could not safely close the Google Docs export response.", {
            errorCode: "google_doc_response_cleanup_failed",
            statusCode: 502,
          });
        }
        if (error instanceof GoogleDocTooLargeError) {
          exportTooLarge = true;
        } else {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (!text && !exportTooLarge) {
      try {
        text = await exportPublicDocument(documentId);
        source = "public-export";
      } catch (error) {
        if (error instanceof GoogleDocResponseCleanupError) {
          fail("Could not safely close the Google Docs export response.", {
            errorCode: "google_doc_response_cleanup_failed",
            statusCode: 502,
          });
        }
        if (error instanceof GoogleDocTooLargeError) {
          exportTooLarge = true;
        } else {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (exportTooLarge) {
      fail("Google Doc export exceeds the supported size limit.", {
        errorCode: "google_doc_too_large",
        statusCode: 413,
      });
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
