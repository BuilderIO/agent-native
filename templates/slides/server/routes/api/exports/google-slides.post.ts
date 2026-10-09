import { runWithRequestContext } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import { resolveSlidesRequestAuth } from "../../../handlers/request-auth-context.js";
import { trackDeckExported } from "../../../lib/deck-export-tracking.js";
import { getGoogleDocsAccessToken } from "../../../lib/google-docs-oauth.js";
import { requestWaitUntil } from "../../../lib/request-wait-until.js";
import { generationAttemptIdOf } from "../../../lib/slides-tracking.js";

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

function optionalFormText(
  parts: Array<{ name?: string; data: Uint8Array }>,
  name: string,
): string | undefined {
  const part = parts.find((candidate) => candidate.name === name);
  const value = part ? new TextDecoder().decode(part.data).trim() : "";
  return value || undefined;
}

// The deck id comes from the browser, so it is only attached once the user is
// shown to have access; slide count and attempt id are read from the deck
// rather than trusted from the form.
async function exportFacts(parts: Array<{ name?: string; data: Uint8Array }>) {
  const renderLocation =
    optionalFormText(parts, "renderLocation") === "server"
      ? ("server" as const)
      : ("browser" as const);
  const deckId = optionalFormText(parts, "deckId");
  if (!deckId) return { renderLocation };
  try {
    const access = await resolveAccess("deck", deckId);
    const data = (access?.resource as { data?: unknown } | undefined)?.data;
    if (typeof data !== "string") return { renderLocation };
    const deck = JSON.parse(data) as {
      slides?: unknown;
      generationContext?: unknown;
    };
    const generationAttemptId = generationAttemptIdOf(deck.generationContext);
    return {
      renderLocation,
      deckId,
      ...(Array.isArray(deck.slides) ? { slideCount: deck.slides.length } : {}),
      ...(generationAttemptId ? { generationAttemptId } : {}),
    };
  } catch {
    // coercion-ok: an unreadable deck only drops deck attribution from the analytics event; the export itself proceeds.
    return { renderLocation };
  }
}

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

  // Started now, awaited only when the event is sent: the analytics lookup
  // must never delay or block the user's export.
  const factsPromise = Promise.resolve(
    runWithRequestContext(
      { userEmail: sessionEmail, orgId: session.orgId },
      () => exportFacts(parts),
    ),
  );
  // The send may finish after the response; waitUntil keeps a serverless
  // function alive for it without delaying the response.
  const waitUntil = requestWaitUntil(event);
  const trackExport = (errorType?: string) => {
    const send = factsPromise
      .then((facts) =>
        trackDeckExported(
          {
            ...facts,
            exportFormat: "google_slides",
            status: errorType ? "failed" : "completed",
            ...(errorType ? { errorType } : {}),
          },
          { userId: sessionEmail },
        ),
      )
      .catch(() => {
        // coercion-ok: analytics is best-effort and must not affect the export response.
      });
    try {
      waitUntil?.(send);
    } catch {
      // coercion-ok: a platform without a usable waitUntil still sends the event; it just isn't held open.
    }
  };

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
      trackExport("google_not_connected");
      setResponseStatus(event, 409);
      return {
        error:
          "Google Drive connection expired. Connect Google again, then retry.",
        code: "google-not-connected",
      };
    }
    trackExport("google_connection_failed");
    setResponseStatus(event, 502);
    return { error: "Could not use the Google Drive connection. Try again." };
  }
  if (!account) {
    trackExport("google_not_connected");
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
    trackExport("drive_unreachable");
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
    trackExport("google_not_connected");
    setResponseStatus(event, 409);
    return {
      error:
        "Google Drive connection expired. Connect Google again, then retry.",
      code: "google-not-connected",
    };
  }

  const url = result ? googleSlidesEditUrl(result) : undefined;
  if (!response.ok || !url) {
    trackExport("drive_upload_failed");
    setResponseStatus(event, 502);
    return {
      error:
        result?.error?.message ??
        `Google Drive returned HTTP ${response.status} while creating the deck.`,
    };
  }

  trackExport();
  return { url, accountEmail: account.accountEmail };
});
