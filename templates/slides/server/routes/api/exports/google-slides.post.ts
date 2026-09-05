import { runWithRequestContext } from "@agent-native/core/server";
import {
  defineEventHandler,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import { resolveSlidesRequestAuth } from "../../../handlers/request-auth-context.js";
import { getGoogleDocsAccessToken } from "../../../lib/google-docs-oauth.js";

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

function isGoogleReconnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_grant|connection expired|token(?: has been)? expired|please reconnect/i.test(
    message,
  );
}

function googleSlidesEditUrl(result: {
  id?: string;
  webViewLink?: string;
}): string | undefined {
  const id = result.id?.trim();
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
    return `https://docs.google.com/presentation/d/${id}/edit`;
  }
  return result.webViewLink;
}

/**
 * Uploads a PPTX into the user's Drive, letting Drive convert it to a native
 * Google Slides deck. The caller decides which exporter produced those bytes,
 * and which one is higher fidelity depends on the deck:
 *
 * - Source-imported decks go through the server `export-pptx`, which writes the
 *   source's own geometry as real vector shapes. The browser exporter cannot —
 *   `dom-to-pptx` has no custom-geometry support at all and rasterizes every
 *   vector shape to a bitmap, so Google receives silhouettes instead of curves.
 * - Editor-authored decks go through the browser exporter, the only place
 *   geometry positioned in the DOM is measurable.
 *
 * See "Export Behavior" in `templates/slides/AGENTS.md` for the routing rule.
 */
export default defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const session = auth.context;
  const sessionEmail = session.email;
  if (!sessionEmail) {
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
  let account: Awaited<ReturnType<typeof getGoogleDocsAccessToken>>;
  try {
    account = await runWithRequestContext(
      { userEmail: sessionEmail, orgId: session.orgId },
      () =>
        getGoogleDocsAccessToken(sessionEmail, {
          requireDriveUploadScope: true,
        }),
    );
  } catch (error) {
    if (isGoogleReconnectError(error)) {
      setResponseStatus(event, 409);
      return {
        error:
          "Google Drive connection expired. Connect Google again, then retry.",
        code: "google-not-connected",
      };
    }
    setResponseStatus(event, 502);
    return { error: "Could not use the Google Drive connection. Try again." };
  }
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

  let response: Response;
  try {
    response = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
  } catch {
    setResponseStatus(event, 502);
    return { error: "Could not reach Google Drive. Try again." };
  }

  const result = (await response.json().catch(() => null)) as {
    id?: string;
    webViewLink?: string;
    error?: {
      message?: string;
      errors?: Array<{ reason?: string }>;
    };
  } | null;

  const hasInsufficientPermissions =
    response.status === 403 &&
    (result?.error?.errors?.some(
      ({ reason }) => reason === "insufficientPermissions",
    ) ||
      /insufficient(?:permissions| permission| scope)/i.test(
        result?.error?.message ?? "",
      ));

  if (response.status === 401 || hasInsufficientPermissions) {
    setResponseStatus(event, 409);
    return {
      error:
        "Google Drive connection expired. Connect Google again, then retry.",
      code: "google-not-connected",
    };
  }

  const url = result ? googleSlidesEditUrl(result) : undefined;
  if (!response.ok || !url) {
    setResponseStatus(event, 502);
    return {
      error:
        result?.error?.message ??
        `Google Drive returned HTTP ${response.status} while creating the deck.`,
    };
  }

  return { url, accountEmail: account.accountEmail };
});
