import fs from "node:fs";
import crypto from "node:crypto";
import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import {
  extractGoogleDocId,
  normalizeGoogleDocText,
} from "../shared/google-docs.js";
import { getGoogleDocsAccessToken } from "../server/lib/google-docs-oauth.js";

const DEFAULT_MAX_CHARS = 60_000;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface ServiceAccountAccessTokenResult {
  token: string;
  serviceAccountEmail: string;
}

class GoogleDocAccessError extends Error {}

function parseServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    try {
      return JSON.parse(fs.readFileSync(raw, "utf-8")) as ServiceAccountKey;
    } catch {
      return null;
    }
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function getServiceAccountAccessToken(): Promise<ServiceAccountAccessTokenResult | null> {
  const key = parseServiceAccountKey();
  if (!key?.client_email || !key.private_key) return null;

  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: key.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ].join(".");

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(key.private_key, "base64url")}`;

  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    },
  );

  if (!response.ok) return null;
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) return null;

  return {
    token: data.access_token,
    serviceAccountEmail: key.client_email,
  };
}

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
    "connected Google Docs account, and private Docs shared with the configured " +
    "GOOGLE_SERVICE_ACCOUNT_KEY service account.",
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

    let serviceAccount: ServiceAccountAccessTokenResult | null = null;
    try {
      serviceAccount = await getServiceAccountAccessToken();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    let text: string | null = null;
    let source: "user-oauth" | "service-account" | "public-export" | null =
      null;

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

    if (!text && serviceAccount) {
      try {
        text = await exportWithDriveToken(documentId, serviceAccount.token);
        source = "service-account";
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
      const shareTarget = serviceAccount?.serviceAccountEmail;
      const shareHint = userConnection
        ? `Choose this document from the Google Docs picker so ${userConnection.accountEmail} grants file access, share it with ${shareTarget ?? "the configured service account"}, or set the link to "Anyone with the link can view", then try again.`
        : shareTarget
          ? `Connect Google Docs and choose the file, share the document with ${shareTarget}, or set the link to "Anyone with the link can view", then try again.`
          : 'Connect Google Docs and choose the file, set GOOGLE_SERVICE_ACCOUNT_KEY so private Docs can be shared with the service account, set the link to "Anyone with the link can view", or upload an exported .docx file.';
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
      serviceAccountEmail: serviceAccount?.serviceAccountEmail,
      note: truncated
        ? `Returned the first ${limit} characters. Ask for a higher maxChars value if more context is needed.`
        : undefined,
    };
  },
});
