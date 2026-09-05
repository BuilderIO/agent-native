import { uploadFile } from "@agent-native/core/file-upload";
import {
  isAllowedUploadMimeType,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  readMultipartFormData,
  setResponseStatus,
  type H3Event,
} from "h3";

import type { FormField, FormSettings } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import {
  acceptsFormFileType,
  DEFAULT_FORM_FILE_MAX_BYTES,
  formFileMaxBytes,
  isSafeFormFileUrl,
  MAX_FORM_FILE_NAME_LENGTH,
} from "../lib/file-upload-policy.js";
import { findFormBySlugOrId } from "../lib/form-lookup.js";
import {
  isPublicFormOriginAllowed,
  parseStoredFormSettings,
  setPublicFormCors,
} from "../lib/form-request.js";
import { assertValidFields } from "../lib/validate-fields.js";

const MAX_UPLOAD_REQUEST_BYTES = DEFAULT_FORM_FILE_MAX_BYTES + 32 * 1024;

function cleanFilename(value: string | undefined): string {
  const filename = (value || "upload")
    .replace(/[\\/]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "_")
    .trim()
    .slice(0, MAX_FORM_FILE_NAME_LENGTH);
  return filename || "upload";
}

function invalidFormResponse(event: H3Event) {
  setResponseStatus(event, 500);
  return { error: "Form configuration is invalid" };
}

function contentLengthExceedsLimit(event: H3Event): boolean {
  const raw = getRequestHeader(event, "content-length");
  if (!raw) return false;
  const length = Number(raw);
  return !Number.isSafeInteger(length) || length > MAX_UPLOAD_REQUEST_BYTES;
}

export const uploadFormFile = defineEventHandler(async (event: H3Event) => {
  const identifier = getRouterParam(event, "id")?.trim() ?? "";
  const form = await findFormBySlugOrId(getDb(), identifier);
  if (!form || form.status !== "published" || form.deletedAt) {
    setResponseStatus(event, 404);
    return { error: "Form not found or not accepting responses" };
  }

  let settings: FormSettings;
  let fields: FormField[];
  try {
    settings = parseStoredFormSettings(form.settings);
    fields = JSON.parse(form.fields);
    assertValidFields(fields);
  } catch {
    return invalidFormResponse(event);
  }

  setPublicFormCors(event, settings);
  if (!isPublicFormOriginAllowed(event, settings)) {
    setResponseStatus(event, 403);
    return { error: "Origin not allowed" };
  }

  const contentType = getRequestHeader(event, "content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    setResponseStatus(event, 415);
    return { error: "File uploads must use multipart/form-data" };
  }
  if (contentLengthExceedsLimit(event)) {
    setResponseStatus(event, 413);
    return { error: "File upload is too large" };
  }

  let parts;
  try {
    parts = await readMultipartFormData(event);
  } catch (error) {
    console.warn(
      "[forms] multipart file upload could not be parsed:",
      error instanceof Error ? error.message : String(error),
    );
    setResponseStatus(event, 400);
    return { error: "Invalid file upload" };
  }
  if (!parts) {
    setResponseStatus(event, 400);
    return { error: "Invalid file upload" };
  }

  const fieldParts = parts.filter((part) => part.name === "fieldId");
  const fileParts = parts.filter(
    (part) => part.name === "file" && part.filename !== undefined,
  );
  const fieldId = fieldParts[0]?.data
    ? Buffer.from(fieldParts[0].data).toString("utf8").trim()
    : "";
  if (
    fieldParts.length !== 1 ||
    fileParts.length !== 1 ||
    !fieldParts[0]?.data ||
    !fileParts[0].data.length ||
    !fieldId
  ) {
    setResponseStatus(event, 400);
    return { error: "A field and one file are required" };
  }

  const field = fields.find((candidate) => candidate.id === fieldId);
  if (!field || field.type !== "file") {
    setResponseStatus(event, 400);
    return { error: "File field not found" };
  }

  const filePart = fileParts[0];
  const filename = cleanFilename(filePart.filename);
  const mimeType = (filePart.type || "").split(";", 1)[0]!.trim().toLowerCase();
  const maxBytes = formFileMaxBytes(field);
  if (filePart.data.length > maxBytes) {
    setResponseStatus(event, 413);
    return { error: "File is too large" };
  }
  if (
    !mimeType ||
    !isAllowedUploadMimeType(mimeType) ||
    !acceptsFormFileType(field, mimeType, filename)
  ) {
    setResponseStatus(event, 415);
    return { error: "File type is not accepted by this form" };
  }

  const upload = () =>
    uploadFile({
      data: filePart.data,
      filename,
      mimeType,
      ownerEmail: form.ownerEmail ?? undefined,
      stableUrl: true,
      recordAsset: false,
    });
  let uploaded;
  try {
    uploaded = form.ownerEmail
      ? await runWithRequestContext(
          { userEmail: form.ownerEmail, orgId: form.orgId ?? undefined },
          upload,
        )
      : await upload();
  } catch (error) {
    console.warn(
      "[forms] file upload failed:",
      error instanceof Error ? error.message : String(error),
    );
    setResponseStatus(event, 503);
    return { error: "File storage upload failed" };
  }
  if (!uploaded) {
    setResponseStatus(event, 503);
    return {
      error:
        "File storage is not configured. Connect Builder.io or register a file upload provider before accepting files.",
      storageSetupRequired: true,
    };
  }
  if (!isSafeFormFileUrl(uploaded.url)) {
    setResponseStatus(event, 502);
    return { error: "File storage returned an invalid file URL" };
  }

  setResponseStatus(event, 201);
  return {
    url: uploaded.url,
    name: filename,
    type: mimeType,
    size: filePart.data.length,
    ...(uploaded.id ? { id: uploaded.id } : {}),
    provider: uploaded.provider,
  };
});
