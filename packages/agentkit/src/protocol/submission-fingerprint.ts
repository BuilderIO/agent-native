import { sha256 } from "@noble/hashes/sha2.js";

type SubmissionAttachmentKind = "file" | "image";

function stableSubmissionJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSubmissionJson).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableSubmissionJson(record[key])}`)
    .join(",")}}`;
}

function normalizedMediaType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType && mediaType !== "image" ? mediaType : undefined;
}

function submissionAttachmentIdentity(
  value: unknown,
  kind?: SubmissionAttachmentKind,
): Record<string, unknown> {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const attachmentKind = kind ?? (record.type === "image" ? "image" : "file");
  const name = typeof record.name === "string" ? record.name : "";

  if (attachmentKind === "image") {
    const contentType = normalizedMediaType(
      record.contentType ?? record.mediaType,
    );
    return {
      type: "image",
      name,
      ...(contentType ? { contentType } : {}),
      ...(typeof record.data === "string" ? { data: record.data } : {}),
      ...(typeof record.url === "string" ? { url: record.url } : {}),
      ...(typeof record.referenceUrl === "string"
        ? { referenceUrl: record.referenceUrl }
        : {}),
    };
  }

  const url = typeof record.url === "string" ? record.url : undefined;
  const dataUrlMediaType = url?.match(/^data:([^;,]+)/i)?.[1];
  const mediaType = normalizedMediaType(
    dataUrlMediaType ?? record.mediaType ?? record.contentType,
  );
  const fileId =
    typeof record.fileId === "string"
      ? record.fileId
      : typeof record.id === "string"
        ? record.id
        : undefined;
  return {
    type: "file",
    name,
    ...(mediaType ? { mediaType } : {}),
    ...(fileId ? { fileId } : {}),
    ...(typeof record.data === "string" ? { data: record.data } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    ...(url ? { url } : {}),
    ...(record.omitted === "inline-bytes" || record.omitted === "unsafe-url"
      ? { omitted: record.omitted }
      : {}),
  };
}

export function fingerprintAgentSubmissionAttachment(
  value: unknown,
  kind?: SubmissionAttachmentKind,
): string {
  const bytes = new TextEncoder().encode(
    stableSubmissionJson(submissionAttachmentIdentity(value, kind)),
  );
  return Array.from(sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function submissionAttachmentsMatch(
  submission: {
    attachments?: readonly {
      type: "file";
      name: string;
      fingerprint: string;
    }[];
    requestAttachments?: readonly {
      type: "image";
      name: string;
      fingerprint: string;
    }[];
  },
  attachments: readonly unknown[],
): boolean {
  const unmatched = new Set(attachments.map((_, index) => index));
  const matchedRequestAttachments: Record<string, unknown>[] = [];
  const recordAt = (index: number): Record<string, unknown> | null => {
    const attachment = attachments[index];
    return attachment &&
      typeof attachment === "object" &&
      !Array.isArray(attachment)
      ? (attachment as Record<string, unknown>)
      : null;
  };

  for (const identity of submission.attachments ?? []) {
    const match = [...unmatched].find((index) => {
      const attachment = recordAt(index);
      return (
        attachment !== null &&
        fingerprintAgentSubmissionAttachment(attachment, "file") ===
          identity.fingerprint
      );
    });
    if (match === undefined) return false;
    unmatched.delete(match);
  }

  for (const identity of submission.requestAttachments ?? []) {
    const match = [...unmatched].find((index) => {
      const attachment = recordAt(index);
      return (
        attachment !== null &&
        attachment.type === "image" &&
        fingerprintAgentSubmissionAttachment(attachment, "image") ===
          identity.fingerprint
      );
    });
    if (match === undefined) return false;
    unmatched.delete(match);
    const attachment = recordAt(match);
    if (attachment) matchedRequestAttachments.push(attachment);
  }

  const referenceOnlyCounts = new Map<Record<string, unknown>, number>();
  for (const index of unmatched) {
    const extra = recordAt(index);
    if (extra?.referenceOnly !== true || typeof extra.url !== "string") {
      return false;
    }
    const parent = matchedRequestAttachments.find(
      (requestAttachment) =>
        requestAttachment.referenceUrl === extra.url &&
        requestAttachment.name === extra.name,
    );
    if (!parent) return false;
    const count = (referenceOnlyCounts.get(parent) ?? 0) + 1;
    if (count > 1) return false;
    referenceOnlyCounts.set(parent, count);
  }

  return true;
}
