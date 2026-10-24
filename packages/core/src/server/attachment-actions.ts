import { randomUUID } from "node:crypto";

import type { ActionEntry } from "../agent/production-agent.js";
import {
  decodeTextAttachmentData,
  isTextLikeFilename,
  isTextLikeMimeType,
  ATTACHMENT_REFERENCE_MIME_TYPE,
  MAX_ATTACHMENT_RESOURCE_BODY_CHARS,
  type TextAttachmentStorage,
  unwrapTextAttachmentEnvelope,
} from "../file-upload/attachment-text.js";
import {
  createOwnedAttachmentHydrationBudget,
  describeOwnedFileReadFailure,
  hydrateOwnedFileUrl,
} from "../file-upload/owned-attachment.js";
import { resourceGet, resourcePut, resourceList } from "../resources/store.js";
import { getRequestUserEmail } from "./request-context.js";

export { isTextLikeFilename, isTextLikeMimeType };

const DEFAULT_SLICE_LIMIT = 8_000;
const MAX_SLICE_LIMIT = 50_000;
const ATTACHMENT_RESOURCE_PATH = /^attachments\/[^/]+\/[^/]+$/;

function attachmentResourcePath(
  threadId: string,
  batch: string,
  name: string,
  index: number,
): string {
  return `attachments/${threadId}/${batch}-${index}-${storedAttachmentFileName(name)}`;
}

// Every non-path character used to become "_", so 设计.md and 规格.md shared
// a stored name. Each is now spelled as its code point between underscores,
// and "_" itself is escaped, so distinct names stay distinct.
function storedAttachmentFileName(name: string): string {
  return Array.from(name, (char) =>
    /[a-zA-Z0-9.-]/.test(char)
      ? char
      : `_${char.codePointAt(0)!.toString(16)}_`,
  )
    .join("")
    .slice(0, 200);
}

/** How paths written before batch ids spelled a name. */
function legacyAttachmentFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

// Paths are `<batch>-<index>-<name>`; ones written before batches existed
// are `<index>-<name>` and stay readable until they expire. A batch always
// contains a letter, which is what tells the two formats apart.
function parseStoredAttachmentPath(path: string): {
  batch: string;
  index: number;
  name: string;
} {
  const basename = path.split("/").pop() ?? "";
  const match =
    basename.match(/^([a-z0-9]*[a-z][a-z0-9]*)-(\d+)-(.+)$/) ??
    basename.match(/^()(\d+)-(.+)$/);
  return match
    ? { batch: match[1]!, index: Number(match[2]), name: match[3]! }
    : { batch: "", index: -1, name: basename };
}

function compareNewestAttachmentFirst(
  a: { path: string; updatedAt?: number },
  b: { path: string; updatedAt?: number },
): number {
  const left = parseStoredAttachmentPath(a.path);
  const right = parseStoredAttachmentPath(b.path);
  if (left.batch !== right.batch) return left.batch < right.batch ? 1 : -1;
  // A legacy index only orders files within one message, so legacy paths
  // from different turns are ordered by when they were written.
  if (!left.batch) {
    const byTime = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    if (byTime !== 0) return byTime;
  }
  return right.index - left.index;
}

// A truncation note names one path for the rest of the thread, so each
// request writes its own; the time prefix makes later uploads sort first.
function attachmentBatchId(): string {
  return `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
}

interface StoredAttachmentReference {
  url: string;
  contentType?: string;
  name?: string;
  /** Set when the stored file is pasted text inside its prompt envelope. */
  unwrapEnvelope?: true;
}

// Paging re-reads the file from storage, so a file being read page by page
// is kept for a short while; the total size bound keeps one instance from
// holding many large files at once.
const REREAD_CACHE_TTL_MS = 10 * 60 * 1000;
const REREAD_CACHE_MAX_CHARS = 16_000_000;
const rereadCache = new Map<string, { text: string; expiresAt: number }>();

function cachedReread(key: string): string | undefined {
  const entry = rereadCache.get(key);
  if (!entry) return undefined;
  rereadCache.delete(key);
  if (entry.expiresAt <= Date.now()) return undefined;
  rereadCache.set(key, entry);
  return entry.text;
}

function cacheReread(key: string, text: string): void {
  rereadCache.delete(key);
  if (text.length > REREAD_CACHE_MAX_CHARS) return;
  rereadCache.set(key, { text, expiresAt: Date.now() + REREAD_CACHE_TTL_MS });
  let total = 0;
  for (const entry of rereadCache.values()) total += entry.text.length;
  for (const [oldest, entry] of rereadCache) {
    if (total <= REREAD_CACHE_MAX_CHARS) break;
    rereadCache.delete(oldest);
    total -= entry.text.length;
  }
}

/** @internal exported for unit tests only */
export function clearAttachmentRereadCache(): void {
  rereadCache.clear();
}

/** An upload already lives in file storage, so SQL keeps only where it is. */
function storedAttachmentReference(
  att: {
    url?: string;
    uploadProvider?: string;
    contentType?: string;
    name?: string;
  },
  unwrapEnvelope: boolean,
): StoredAttachmentReference | null {
  if (!att.uploadProvider || !att.url?.startsWith("https://")) return null;
  return {
    url: att.url,
    // The re-read decides "text" from this type, so a generic upload type
    // that was classified by filename must not be stored as-is.
    contentType: isTextLikeMimeType(att.contentType)
      ? att.contentType
      : "text/plain",
    name: att.name,
    ...(unwrapEnvelope ? { unwrapEnvelope: true as const } : {}),
  };
}

async function readStoredAttachmentReference(
  content: string,
): Promise<{ text: string } | { error: string }> {
  let reference: StoredAttachmentReference;
  try {
    reference = JSON.parse(content) as StoredAttachmentReference;
  } catch {
    return { error: "the stored attachment reference is unreadable" };
  }
  const hydration = await hydrateOwnedFileUrl(
    reference.url,
    reference.contentType,
    reference.name,
    createOwnedAttachmentHydrationBudget(),
  );
  if (hydration.kind !== "hydrated") {
    return { error: describeOwnedFileReadFailure(hydration.code) };
  }
  const decoded = decodeTextAttachmentData({
    name: reference.name,
    contentType: reference.contentType,
    data: hydration.dataUrl,
  });
  if (decoded.kind !== "text") {
    return {
      error:
        decoded.kind === "undecodable"
          ? "the stored file is no longer valid UTF-8 text"
          : "the stored file is no longer a text file",
    };
  }
  return {
    text: reference.unwrapEnvelope
      ? unwrapTextAttachmentEnvelope(decoded.text)
      : decoded.text,
  };
}

export async function persistTextAttachmentsAsResources(opts: {
  attachments: Array<{
    type?: string;
    name?: string;
    contentType?: string;
    displayOnly?: boolean;
    text?: string;
    data?: string;
    url?: string;
    uploadProvider?: string;
  }>;
  threadId: string;
  ownerEmail: string | null | undefined;
}): Promise<Map<number, TextAttachmentStorage>> {
  const result = new Map<number, TextAttachmentStorage>();
  const owner = opts.ownerEmail || "anonymous";
  const batch = attachmentBatchId();

  for (let i = 0; i < opts.attachments.length; i++) {
    const att = opts.attachments[i];
    if (att.displayOnly === true) continue;
    const decoded = decodeTextAttachmentData(att);
    const text =
      decoded.kind === "text"
        ? decoded.text
        : (isTextLikeMimeType(att.contentType) ||
              isTextLikeFilename(att.name)) &&
            att.text
          ? unwrapTextAttachmentEnvelope(att.text)
          : undefined;
    if (!text) continue;

    const reference = storedAttachmentReference(att, decoded.kind !== "text");
    // A partial copy would let read-attachment report "End of attachment"
    // for a file whose tail was never stored.
    if (!reference && text.length > MAX_ATTACHMENT_RESOURCE_BODY_CHARS) {
      result.set(i, { kind: "failed", reason: "too-large" });
      continue;
    }

    const path = attachmentResourcePath(
      opts.threadId,
      batch,
      att.name || "attachment",
      i,
    );

    try {
      // The resource store rejects non-URL content under an image/* type, so
      // SVG source is stored as plain text.
      const mimeType = reference
        ? ATTACHMENT_REFERENCE_MIME_TYPE
        : att.contentType && !/^image\//i.test(att.contentType)
          ? att.contentType
          : "text/plain";
      const content = reference ? JSON.stringify(reference) : text;
      const resource = await resourcePut(owner, path, content, mimeType, {
        createdBy: "user",
        visibility: "agent_scratch",
        threadId: opts.threadId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      result.set(i, {
        kind: "stored",
        resourceId: resource.id,
        path,
        totalChars: text.length,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(
        "[agent-native] persistTextAttachmentsAsResources failed:",
        error,
      );
      result.set(i, { kind: "failed", reason: "write-failed", error });
    }
  }

  return result;
}

export function createCoreAttachmentActionEntries(): Record<
  string,
  ActionEntry
> {
  return {
    "read-attachment": {
      tool: {
        description: [
          "Read a slice of a large text attachment (CSV, code, JSON, markdown, SVG, plain text) that was",
          "truncated in the conversation context. When a <chat-attachment-truncated> note names an",
          "attachment, read it as the note directs before you edit, summarize, or answer from it. If the",
          "file is too long to read in full, read the parts the request depends on and tell the user which",
          "parts you did not read.",
          "",
          "Identify the attachment by the path a <chat-attachment-truncated> note gives, or by name",
          "(e.g. name='data.csv') as shown in the <attachment name='...'> tag. Use offset and limit to",
          "page through it.",
          "",
          "Returns { content, offset, limit, totalChars, hasMore }.",
          "If totalChars is unknown (attachment not stored as a resource), returns a not-found message.",
        ].join("\n"),
        parameters: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description:
                "The stored attachment path from a <chat-attachment-truncated> note. Preferred over name.",
            },
            name: {
              type: "string",
              description:
                "The exact attachment name as it appeared in the <attachment name='...'> tag.",
            },
            threadId: {
              type: "string",
              description:
                "The chat thread ID. If omitted, the current thread is used.",
            },
            offset: {
              type: "string",
              description:
                "Character offset to start reading from. Default: 0.",
            },
            limit: {
              type: "string",
              description: `Maximum characters to return. Default: ${DEFAULT_SLICE_LIMIT}. Maximum: ${MAX_SLICE_LIMIT}.`,
            },
          },
        },
      },
      run: async (input: Record<string, string>, ctx) => {
        const ownerEmail =
          ctx?.userEmail || getRequestUserEmail() || "anonymous";
        const path = String(input.path || "").trim();
        const name = String(input.name || "").trim() || path.split("/").pop()!;
        const offset = Math.max(0, parseInt(input.offset || "0", 10) || 0);
        const limit = Math.min(
          MAX_SLICE_LIMIT,
          Math.max(
            1,
            parseInt(input.limit || String(DEFAULT_SLICE_LIMIT), 10) ||
              DEFAULT_SLICE_LIMIT,
          ),
        );

        if (!name) {
          return { error: "name or path is required" };
        }
        if (path && !ATTACHMENT_RESOURCE_PATH.test(path)) {
          return { error: `"${path}" is not a stored attachment path.` };
        }

        let threadId = path
          ? path.split("/")[1]!
          : String(input.threadId || "").trim();
        if (!threadId) {
          try {
            const { getRequestRunContext } =
              await import("./request-context.js");
            const runCtx = getRequestRunContext();
            threadId = (runCtx as any)?.threadId || "";
          } catch {
            // ignore
          }
        }

        if (!threadId) {
          return {
            error:
              "threadId is required (could not be resolved from context). Re-call with the thread id.",
          };
        }

        try {
          const prefix = `attachments/${threadId}/`;
          const metas = await resourceList(ownerEmail, prefix, {
            includeAgentScratch: true,
          });

          const storedName = (m: { path: string }) => {
            const parsed = parseStoredAttachmentPath(m.path);
            return {
              actual: parsed.name,
              wanted: parsed.batch
                ? storedAttachmentFileName(name)
                : legacyAttachmentFileName(name),
            };
          };
          const exact = path
            ? metas.filter((m) => m.path === path)
            : metas.filter((m) => {
                const { actual, wanted } = storedName(m);
                return actual === wanted;
              });
          const candidates =
            exact.length > 0 || path
              ? exact
              : metas.filter((m) => {
                  const { actual, wanted } = storedName(m);
                  return actual.toLowerCase() === wanted.toLowerCase();
                });

          if (candidates.length === 0) {
            return {
              error: `No stored attachment found with name "${name}" in thread ${threadId}. The attachment may not have been persisted as a resource (only text-like files are stored).`,
            };
          }

          const [meta, next] = candidates.sort(compareNewestAttachmentFirst);
          const newestBatch = parseStoredAttachmentPath(meta.path).batch;
          // Legacy paths have no batch, so they never prove two files were
          // sent together.
          if (
            next &&
            newestBatch &&
            parseStoredAttachmentPath(next.path).batch === newestBatch
          ) {
            const paths = candidates
              .filter(
                (m) => parseStoredAttachmentPath(m.path).batch === newestBatch,
              )
              .map((m) => m.path);
            return {
              error: `"${name}" matches more than one attachment sent together: ${paths.join(", ")}. Call again with one of these as path.`,
            };
          }
          const resource = await resourceGet(meta.id);
          if (!resource) {
            return { error: `Attachment resource "${name}" not found.` };
          }

          let content = resource.content;
          if (resource.mimeType === ATTACHMENT_REFERENCE_MIME_TYPE) {
            const cacheKey = `${resource.id}:${resource.content}`;
            const cached = cachedReread(cacheKey);
            if (cached !== undefined) {
              content = cached;
            } else {
              const read = await readStoredAttachmentReference(content);
              if ("error" in read) {
                return {
                  error: `Could not re-read "${name}" from file storage: ${read.error}. Tell the user which part of the file you could not read before doing anything that depends on it.`,
                };
              }
              cacheReread(cacheKey, read.text);
              content = read.text;
            }
          }
          const totalChars = content.length;
          const slice = content.slice(offset, offset + limit);
          return {
            name,
            content: slice,
            offset,
            limit,
            totalChars,
            hasMore: offset + limit < totalChars,
            note:
              offset + limit < totalChars
                ? `${totalChars - offset - limit} chars remain. Call again with offset=${offset + limit}.`
                : "End of attachment.",
          };
        } catch (err) {
          return {
            error: `Failed to read attachment: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  };
}
