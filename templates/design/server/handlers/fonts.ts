import path from "node:path";

import { uploadFile } from "@agent-native/core/file-upload";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  TOTAL_BODY_LIMIT,
} from "../lib/request-body-limits.js";

const FONT_FORMATS = {
  ".otf": { format: "opentype", mimeType: "font/otf" },
  ".ttf": { format: "truetype", mimeType: "font/ttf" },
  ".woff": { format: "woff", mimeType: "font/woff" },
  ".woff2": { format: "woff2", mimeType: "font/woff2" },
} as const;

function ascii(data: Uint8Array, start: number, end: number): string {
  return Buffer.from(data.subarray(start, end)).toString("ascii");
}

function hasFontSignature(ext: keyof typeof FONT_FORMATS, data: Uint8Array) {
  if (ext === ".woff" || ext === ".woff2") {
    return ascii(data, 0, 4) === (ext === ".woff" ? "wOFF" : "wOF2");
  }
  if (ext === ".otf") return ascii(data, 0, 4) === "OTTO";
  return data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0;
}

function fieldText(
  parts: Awaited<ReturnType<typeof readMultipartFormData>>,
  name: string,
): string | undefined {
  const part = parts?.find((candidate) => candidate.name === name);
  return part?.data
    ? Buffer.from(part.data).toString("utf8").trim()
    : undefined;
}

function safeFamilyName(value: string | undefined, filename: string): string {
  const fallback = path.basename(filename, path.extname(filename));
  const family = (value || fallback)
    .replace(/["'\\{};,\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (!family) throw new Error("Font family is required");
  return family;
}

function safeWeight(value: string | undefined): string {
  const weight = value?.trim() || "400";
  if (!/^\d{3}(?:\s+\d{3})?$/.test(weight)) {
    throw new Error("Font weight is invalid");
  }
  const values = weight.split(/\s+/).map(Number);
  if (values.some((entry) => entry < 1 || entry > 1000)) {
    throw new Error("Font weight is invalid");
  }
  return weight;
}

function safeStyle(value: string | undefined): "normal" | "italic" {
  if (value === "italic") return "italic";
  if (!value || value === "normal") return "normal";
  throw new Error("Font style is invalid");
}

export const uploadFont = defineEventHandler(async (event) => {
  let session;
  try {
    session = await getSession(event);
  } catch (error) {
    console.error("[design-font-upload] session lookup failed", error);
    setResponseStatus(event, 503);
    return { error: "Authentication service unavailable" };
  }
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const contentLength = Number(getRequestHeader(event, "content-length") ?? 0);
  if (contentLength > TOTAL_BODY_LIMIT) {
    setResponseStatus(event, 413);
    return { error: "Request body too large" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      try {
        const parts = await readMultipartFormData(event);
        const designId = fieldText(parts, "designId");
        if (!designId) {
          setResponseStatus(event, 400);
          return { error: "Missing designId" };
        }
        await assertAccess("design", designId, "editor");

        const filePart = parts?.find(
          (part) => part.name === "file" && part.data,
        );
        if (!filePart?.data) {
          setResponseStatus(event, 400);
          return { error: "No font uploaded" };
        }
        if (filePart.data.length > MAX_UPLOAD_BYTES) {
          setResponseStatus(event, 413);
          return { error: `Font is too large (max ${MAX_UPLOAD_MB} MB)` };
        }

        const originalName = filePart.filename || "font.woff2";
        const ext = path
          .extname(originalName)
          .toLowerCase() as keyof typeof FONT_FORMATS;
        const format = FONT_FORMATS[ext];
        if (!format || !hasFontSignature(ext, filePart.data)) {
          setResponseStatus(event, 400);
          return { error: "Choose a valid .woff2, .woff, .ttf, or .otf font" };
        }

        const family = safeFamilyName(fieldText(parts, "family"), originalName);
        const weight = safeWeight(fieldText(parts, "weight"));
        const style = safeStyle(fieldText(parts, "style"));
        let uploaded;
        try {
          uploaded = await uploadFile({
            data: Buffer.from(filePart.data),
            filename: originalName,
            mimeType: format.mimeType,
            ownerEmail: session.email,
            recordAsset: false,
          });
        } catch (error) {
          console.error("[design-font-upload] upload failed", error);
          setResponseStatus(event, 502);
          return { error: "Font upload failed" };
        }
        if (!uploaded) {
          setResponseStatus(event, 503);
          return { error: "File uploads are not configured" };
        }

        return {
          family,
          url: uploaded.url,
          weight,
          style,
          format: format.format,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Font upload failed";
        setResponseStatus(
          event,
          /access|permission|not allowed/i.test(message) ? 403 : 400,
        );
        return { error: message };
      }
    },
  );
});
