import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  defineEventHandler,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import { getGoogleDocsAccessToken } from "../../../lib/google-docs-oauth.js";

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

/**
 * Uploads a browser-generated PPTX into the user's Drive, letting Drive convert
 * it to a native Google Slides deck. The PPTX comes from the client because the
 * browser export renders the real slide DOM — the server-side pptxgenjs export
 * is a lower-fidelity fallback and would ship a visibly worse deck to Google.
 */
export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const parts = (await readMultipartFormData(event)) ?? [];
  const file = parts.find((part) => part.name === "file");
  const titlePart = parts.find((part) => part.name === "title");
  const title = titlePart
    ? new TextDecoder().decode(titlePart.data).trim() || "Untitled deck"
    : "Untitled deck";

  if (!file?.data?.length) {
    setResponseStatus(event, 400);
    return { error: "file required" };
  }

  // Same request context the actions run in — Google's client credentials can
  // be org-scoped vault secrets, and resolving them without the org reports the
  // integration as unconfigured.
  const account = await runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    () => getGoogleDocsAccessToken(session.email),
  );
  if (!account) {
    setResponseStatus(event, 409);
    return {
      error: "No connected Google account.",
      code: "google-not-connected",
    };
  }

  const boundary = `an-slides-${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name: title, mimeType: GOOGLE_SLIDES_MIME }),
    `\r\n--${boundary}\r\nContent-Type: ${PPTX_CONTENT_TYPE}\r\n\r\n`,
    new Uint8Array(file.data),
    `\r\n--${boundary}--`,
  ]);

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const result = (await response.json().catch(() => null)) as {
    id?: string;
    webViewLink?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok || !result?.webViewLink) {
    setResponseStatus(event, 502);
    return {
      error:
        result?.error?.message ??
        `Google Drive returned HTTP ${response.status} while creating the deck.`,
    };
  }

  return { url: result.webViewLink, accountEmail: account.accountEmail };
});
