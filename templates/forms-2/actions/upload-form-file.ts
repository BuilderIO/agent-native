import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { deriveQuestions, MAX_UPLOAD_MB } from "../shared/form-model/index.js";
import { formsErrors } from "./_access.js";
import { ipHashFor, passwordGate } from "./_collection.js";
import { findPublicForm, isClosedNow } from "./_form-store.js";
import {
  formOwner,
  logUpload,
  uploadAsOwner,
  uploadRefusal,
} from "./_upload-storage.js";

const DEFAULT_FILE_MB = 10;
const SIGNATURE_MAX_MB = 1;

function typeAllowed(mime: string, allowed: unknown): boolean {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.some(
    (entry) =>
      typeof entry === "string" &&
      (entry.endsWith("/*")
        ? mime.startsWith(entry.slice(0, -1))
        : mime === entry),
  );
}

export default defineAction({
  description:
    "Upload one file or signature image for a file-upload or signature question of a published form and return its hosted URL; no sign-in needed. Enforces the question's size and type limits, a rate limit and a cap on files per submission. Stores the file with the form owner's file storage, so the owner must have it set up.",
  schema: z.object({
    formId: z.string().min(1).max(64).describe("Form id"),
    questionId: z
      .string()
      .min(1)
      .max(64)
      .describe("The file-upload or signature question's group uuid"),
    sessionId: z
      .string()
      .min(1)
      .max(100)
      .describe("The respondent's session id for this submission"),
    password: z
      .string()
      .max(200)
      .optional()
      .describe("Required when the form is password protected"),
    filename: z.string().min(1).max(200).describe("File name"),
    contentType: z.string().min(1).max(100).describe("MIME type"),
    data: z
      .string()
      .max(Math.ceil((MAX_UPLOAD_MB * 1024 * 1024 * 4) / 3) + 8)
      .describe("File bytes, base64 encoded"),
  }),
  outputSchema: z.object({ url: z.string() }),
  errors: formsErrors,
  requiresAuth: false,
  run: async ({
    formId,
    questionId,
    sessionId,
    password,
    filename,
    contentType,
    data,
  }) => {
    const db = getDb();
    const found = await findPublicForm(db, formId);
    const question = found
      ? deriveQuestions(found.form.publishedBlocks).find(
          (candidate) => candidate.id === questionId,
        )
      : undefined;
    if (
      !found ||
      (question?.type !== "FILE_UPLOAD" && question?.type !== "SIGNATURE")
    )
      return formsErrors.noWrite("Nothing here accepts files.", "not_found", {
        statusCode: 404,
      });

    if (isClosedNow(found.form, found.completed))
      return formsErrors.noWrite("This form is closed.", "conflict");
    const gate = await passwordGate(db, found.form, password, sessionId);
    if (gate.status !== "open")
      return formsErrors.noWrite("This form is locked.", "unauthenticated", {
        statusCode: gate.status === "locked" ? 401 : 429,
      });

    const settings = question.settings.payload as Record<string, unknown>;
    const isSignature = question.type === "SIGNATURE";
    const limitMb = isSignature
      ? SIGNATURE_MAX_MB
      : Math.min(
          typeof settings.maxSizeMb === "number"
            ? settings.maxSizeMb
            : DEFAULT_FILE_MB,
          MAX_UPLOAD_MB,
        );
    const bytes = Buffer.from(data, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > limitMb * 1024 * 1024)
      return formsErrors.noWrite(
        `Files can be at most ${limitMb} MB.`,
        "invalid_input",
      );
    if (
      isSignature
        ? contentType !== "image/png"
        : !typeAllowed(contentType, settings.allowedTypes)
    )
      return formsErrors.noWrite(
        "This file type isn't accepted here.",
        "invalid_input",
      );

    const owner = await formOwner(db, found.form);
    if (!owner)
      return formsErrors.noWrite("Nothing here accepts files.", "not_found", {
        statusCode: 404,
      });
    const ipHash = ipHashFor(formId);
    const refusal = await uploadRefusal(db, formId, sessionId, ipHash);
    if (refusal)
      return formsErrors.noWrite(
        refusal === "slow_down"
          ? "Too many uploads. Wait a moment and try again."
          : "This submission has reached its file limit.",
        "invalid_input",
        { statusCode: 429 },
      );

    await logUpload(db, formId, sessionId, ipHash);
    const result = await uploadAsOwner(owner, {
      data: bytes,
      filename,
      mimeType: contentType,
    });
    if (!result)
      return formsErrors.noWrite(
        "Uploads aren't available for this form.",
        "conflict",
      );
    return { url: result.url };
  },
});
