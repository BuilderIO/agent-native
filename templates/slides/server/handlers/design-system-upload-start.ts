import {
  FeatureNotConfiguredError,
  getSession,
  startBuilderDesignSystemUpload,
} from "@agent-native/core/server";
import { defineEventHandler, readBody, setResponseStatus } from "h3";

import { withSlidesRequestContext } from "./request-auth-context.js";

const MAX_FIG_BYTES = 512 * 1024 * 1024;

interface AttachmentInput {
  name?: unknown;
  mimetype?: unknown;
  declaredSize?: unknown;
}

/**
 * Opens signed resumable-upload slots so the browser can stream large `.fig`
 * bytes straight to storage. Only small JSON metadata rides through the app
 * server; the file bytes never do.
 */
export const designSystemUploadStart = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const body = (await readBody(event).catch(() => null)) as {
    attachments?: AttachmentInput[];
  } | null;
  const rawList = Array.isArray(body?.attachments) ? body.attachments : [];
  if (rawList.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No attachments provided." };
  }

  const attachments: {
    name: string;
    mimetype: string;
    declaredSize: number;
  }[] = [];
  for (const raw of rawList) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const mimetype =
      typeof raw?.mimetype === "string" && raw.mimetype.trim()
        ? raw.mimetype.trim()
        : "application/octet-stream";
    const declaredSize = Number(raw?.declaredSize);
    if (!name) {
      setResponseStatus(event, 400);
      return { error: "Attachment name is required." };
    }
    if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
      setResponseStatus(event, 400);
      return { error: "Attachment declaredSize must be a positive integer." };
    }
    if (declaredSize > MAX_FIG_BYTES) {
      setResponseStatus(event, 413);
      return {
        error: `File too large (max ${Math.round(MAX_FIG_BYTES / 1024 / 1024)} MB).`,
      };
    }
    attachments.push({ name, mimetype, declaredSize });
  }

  try {
    const uploads = await withSlidesRequestContext(event, () =>
      startBuilderDesignSystemUpload(attachments),
    );
    return { uploads };
  } catch (err) {
    if (err instanceof FeatureNotConfiguredError) {
      setResponseStatus(event, 412);
      return {
        error: err.message,
        builderConnectUrl:
          err.builderConnectUrl ?? "/_agent-native/builder/connect",
      };
    }
    setResponseStatus(event, 502);
    return {
      error: err instanceof Error ? err.message : "Failed to start upload.",
    };
  }
});
