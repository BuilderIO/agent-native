import { isPersistableAttachmentReferenceUrl } from "@agent-native/agentkit/protocol";
import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";

import {
  estimateAttachmentBodyBytes,
  MAX_ESTIMATED_BODY_BYTES,
} from "../../composer/attachment-accept.js";
import { isPastedTextAttachmentName } from "../../composer/pasted-text.js";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new TypeError("Invalid file reader result"));
    reader.onerror = () =>
      reject(reader.error ?? new TypeError("File read failed"));
    reader.readAsDataURL(file);
  });
}

async function prepareHandoff(
  files: readonly File[],
  options: { attachments?: readonly unknown[] },
): Promise<Pick<AgentChatMessage, "attachments">> {
  const attachments: NonNullable<AgentChatMessage["attachments"]> = [];
  const pending = new Set(files);
  for (const value of options.attachments ?? []) {
    if (!value || typeof value !== "object")
      throw new TypeError("Invalid composer attachment");
    if ("file" in value && value.file instanceof File) {
      const hasDurableContent =
        "content" in value &&
        Array.isArray(value.content) &&
        value.content.some(
          (part: unknown) =>
            part &&
            typeof part === "object" &&
            (("url" in part && isPersistableAttachmentReferenceUrl(part.url)) ||
              ("image" in part &&
                isPersistableAttachmentReferenceUrl(part.image))),
        );
      if (hasDurableContent) pending.delete(value.file);
      else {
        if (
          !isPastedTextAttachmentName(value.file.name) ||
          pending.has(value.file)
        )
          pending.add(value.file);
        continue;
      }
    }
    if (
      !("name" in value) ||
      typeof value.name !== "string" ||
      !("content" in value) ||
      !Array.isArray(value.content)
    ) {
      throw new TypeError("Invalid composer attachment");
    }
    for (const part of value.content) {
      if (!part || typeof part !== "object" || !("type" in part))
        throw new TypeError("Invalid attachment content");
      if (
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        attachments.push({ type: "file", name: value.name, text: part.text });
      } else if (
        part.type === "file" &&
        "url" in part &&
        isPersistableAttachmentReferenceUrl(part.url)
      ) {
        attachments.push({
          type: "file",
          name: value.name,
          url: part.url,
          contentType:
            "mimeType" in part && typeof part.mimeType === "string"
              ? part.mimeType
              : undefined,
        });
      } else if (
        part.type === "image" &&
        "image" in part &&
        typeof part.image === "string" &&
        isPersistableAttachmentReferenceUrl(part.image)
      ) {
        attachments.push({ type: "image", name: value.name, url: part.image });
      } else throw new TypeError("Unsupported attachment content");
    }
  }
  const metadata = [
    JSON.stringify(attachments),
    ...Array.from(pending, (file) =>
      JSON.stringify({ name: file.name, type: file.type }),
    ),
  ];
  const estimatedBytes =
    estimateAttachmentBodyBytes(metadata) +
    Array.from(pending).reduce(
      (sum, file) => sum + (4 * Math.ceil(file.size / 3) + 64) * 1.15,
      0,
    );
  if (estimatedBytes > MAX_ESTIMATED_BODY_BYTES)
    throw Object.assign(new Error("upload_too_large"), {
      code: "upload_too_large",
    });
  for (const file of pending)
    attachments.push({
      type: file.type.startsWith("image/") ? "image" : "file",
      name: file.name,
      contentType: file.type || "application/octet-stream",
      data: await readFile(file),
    });
  return attachments.length ? { attachments } : {};
}

export async function preparePromptComposerAgentHandoff(
  files: readonly File[],
  options: { attachments?: readonly unknown[] },
  failureMessage: string,
): Promise<Pick<AgentChatMessage, "attachments">> {
  try {
    return await prepareHandoff(files, options);
  } catch (cause) {
    throw Object.assign(new Error(failureMessage), {
      cause,
      ...(cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string"
        ? { code: cause.code }
        : {}),
    });
  }
}
