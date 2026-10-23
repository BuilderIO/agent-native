import type { ActionEntry } from "../agent/production-agent.js";
import {
  decodeTextAttachmentData,
  isTextLikeFilename,
  isTextLikeMimeType,
  MAX_ATTACHMENT_RESOURCE_CHARS,
  type TextAttachmentStorage,
} from "../file-upload/attachment-text.js";
import { resourceGet, resourcePut, resourceList } from "../resources/store.js";
import { getRequestUserEmail } from "./request-context.js";

export { isTextLikeFilename, isTextLikeMimeType };

const DEFAULT_SLICE_LIMIT = 8_000;
const MAX_SLICE_LIMIT = 50_000;
const ATTACHMENT_RESOURCE_PATH = /^attachments\/[^/]+\/[^/]+$/;

function attachmentResourcePath(
  threadId: string,
  name: string,
  index: number,
): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `attachments/${threadId}/${index}-${safe}`;
}

export async function persistTextAttachmentsAsResources(opts: {
  attachments: Array<{
    type?: string;
    name?: string;
    contentType?: string;
    displayOnly?: boolean;
    text?: string;
    data?: string;
  }>;
  threadId: string;
  ownerEmail: string | null | undefined;
}): Promise<Map<number, TextAttachmentStorage>> {
  const result = new Map<number, TextAttachmentStorage>();
  const owner = opts.ownerEmail || "anonymous";

  for (let i = 0; i < opts.attachments.length; i++) {
    const att = opts.attachments[i];
    if (att.displayOnly === true) continue;
    const decoded = decodeTextAttachmentData(att);
    const text =
      decoded.kind === "text"
        ? decoded.text
        : isTextLikeMimeType(att.contentType) || isTextLikeFilename(att.name)
          ? att.text
          : undefined;
    if (!text) continue;

    // A partial copy would let read-attachment report "End of attachment"
    // for a file whose tail was never stored.
    if (text.length > MAX_ATTACHMENT_RESOURCE_CHARS) {
      result.set(i, { kind: "failed", reason: "too-large" });
      continue;
    }

    const path = attachmentResourcePath(
      opts.threadId,
      att.name || "attachment",
      i,
    );

    try {
      // The resource store rejects non-URL content under an image/* type, so
      // SVG source is stored as plain text.
      const mimeType =
        att.contentType && !/^image\//i.test(att.contentType)
          ? att.contentType
          : "text/plain";
      const resource = await resourcePut(owner, path, text, mimeType, {
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
          "attachment, call this until hasMore is false before you edit, summarize, or answer from it.",
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

          const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
          const matching = path
            ? metas.filter((m) => m.path === path)
            : metas.filter((m) => m.path.endsWith(`-${safeName}`));

          const candidates =
            matching.length > 0 || path
              ? matching
              : metas.filter((m) => {
                  const basename = m.path.split("/").pop() || "";
                  const withoutIndex = basename.replace(/^\d+-/, "");
                  return withoutIndex
                    .toLowerCase()
                    .includes(name.toLowerCase());
                });

          if (candidates.length === 0) {
            return {
              error: `No stored attachment found with name "${name}" in thread ${threadId}. The attachment may not have been persisted as a resource (only text-like files are stored).`,
            };
          }

          const meta = candidates[0];
          const resource = await resourceGet(meta.id);
          if (!resource) {
            return { error: `Attachment resource "${name}" not found.` };
          }

          const totalChars = resource.content.length;
          const slice = resource.content.slice(offset, offset + limit);
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
