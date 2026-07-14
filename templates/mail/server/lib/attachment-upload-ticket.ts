import crypto from "node:crypto";

import {
  deleteUserSetting,
  getUserSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { nanoid } from "nanoid";

import { extensionForUpload, mimeTypeForUpload } from "./media-upload.js";

const SETTING_KEY = "mail-attachment-upload-ticket";
const TICKET_TTL_MS = 5 * 60 * 1000;

export interface AttachmentUploadTicket extends Record<string, unknown> {
  uploadId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  tokenHash: string;
  expiresAt: number;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function encodeOwner(ownerEmail: string): string {
  return Buffer.from(ownerEmail, "utf8").toString("base64url");
}

function decodeOwner(token: string): string | null {
  const ownerPart = token.split(".", 1)[0];
  if (!ownerPart) return null;
  try {
    const owner = Buffer.from(ownerPart, "base64url").toString("utf8");
    return owner.includes("@") ? owner : null;
  } catch {
    return null;
  }
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function createAttachmentUploadTicket(
  ownerEmail: string,
  originalName: string,
): Promise<AttachmentUploadTicket & { token: string }> {
  const uploadId = nanoid(12);
  const filename = `${uploadId}${extensionForUpload(originalName)}`;
  const token = `${encodeOwner(ownerEmail)}.${crypto.randomBytes(32).toString("base64url")}`;
  const ticket: AttachmentUploadTicket = {
    uploadId,
    filename,
    originalName,
    mimeType: mimeTypeForUpload(originalName),
    tokenHash: tokenHash(token),
    expiresAt: Date.now() + TICKET_TTL_MS,
  };
  // One active upload capability per user keeps ticket creation atomic and
  // bounded. A later call intentionally invalidates an unused older ticket.
  await putUserSetting(ownerEmail, SETTING_KEY, ticket);
  return { ...ticket, token };
}

export async function verifyAttachmentUploadTicket(
  uploadId: string,
  token: string,
): Promise<{ ownerEmail: string; ticket: AttachmentUploadTicket } | null> {
  const ownerEmail = decodeOwner(token);
  if (!ownerEmail) return null;
  const raw = await getUserSetting(ownerEmail, SETTING_KEY);
  if (!raw || typeof raw !== "object") return null;
  const ticket = raw as unknown as AttachmentUploadTicket;
  if (
    ticket.uploadId !== uploadId ||
    typeof ticket.tokenHash !== "string" ||
    !hashesMatch(ticket.tokenHash, tokenHash(token))
  ) {
    return null;
  }
  if (!Number.isFinite(ticket.expiresAt) || ticket.expiresAt < Date.now()) {
    await deleteUserSetting(ownerEmail, SETTING_KEY);
    return null;
  }
  return { ownerEmail, ticket };
}

export async function consumeAttachmentUploadTicket(
  ownerEmail: string,
  uploadId: string,
): Promise<void> {
  const raw = await getUserSetting(ownerEmail, SETTING_KEY);
  if ((raw as Partial<AttachmentUploadTicket> | null)?.uploadId === uploadId) {
    await deleteUserSetting(ownerEmail, SETTING_KEY);
  }
}
