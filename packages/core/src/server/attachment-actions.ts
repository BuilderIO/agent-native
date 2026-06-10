/**
 * Core `read-attachment` agent tool.
 *
 * Large text pastes, CSVs, JSON files, and code files are truncated to
 * 60 K chars when injected into the model context. This action lets the agent
 * read the full content in offset/limit slices from the durable resource
 * stored at attach-time.
 *
 * Storage: text-y attachments are persisted as `agent_scratch` resources
 * keyed  `attachments/<threadId>/<sanitised-name>` under the owner's scope.
 * The maximum stored size per attachment is 20 MB.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { resourceGet, resourcePut, resourceList } from "../resources/store.js";
import { getRequestUserEmail } from "./request-context.js";

const MAX_ATTACHMENT_RESOURCE_BYTES = 20 * 1024 * 1024; // 20 MB
const DEFAULT_SLICE_LIMIT = 8_000; // chars returned by default per call

/**
 * Derive a deterministic resource path for a text attachment stored inside a
 * thread scope.
 */
function attachmentResourcePath(
  threadId: string,
  name: string,
  index: number,
): string {
  // Sanitise the name: keep alphanum, dot, dash, underscore; replace anything
  // else with '_'. Append the index to avoid collisions between same-named
  // files in the same thread.
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `attachments/${threadId}/${index}-${safe}`;
}

/**
 * Determine whether a MIME type or filename represents a text-like attachment
 * that should be stored as a durable resource for paginated reads.
 */
export function isTextLikeMimeType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (ct.startsWith("text/")) return true;
  if (ct === "application/json") return true;
  if (ct === "application/javascript") return true;
  if (ct === "application/typescript") return true;
  return false;
}

export function isTextLikeFilename(name: string | undefined): boolean {
  if (!name) return false;
  return /\.(txt|md|markdown|csv|json|jsonl|yaml|yml|ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|cs|swift|kt|sh|bash|zsh|fish|toml|ini|cfg|conf|xml|html|htm|css|scss|sass|less|sql|graphql|gql)$/i.test(
    name,
  );
}

/**
 * Persist text-ish attachments from a chat turn as thread-scoped resources
 * so the agent can later read them in slices via `read-attachment`.
 *
 * Silently skips attachments that aren't text-like or have no text content.
 * Returns a map from attachment index → stored resource id for use in the
 * truncation-notice injected into the model context.
 */
export async function persistTextAttachmentsAsResources(opts: {
  attachments: Array<{
    type?: string;
    name?: string;
    contentType?: string;
    text?: string;
  }>;
  threadId: string;
  ownerEmail: string | null | undefined;
}): Promise<
  Map<number, { resourceId: string; path: string; totalChars: number }>
> {
  const result = new Map<
    number,
    { resourceId: string; path: string; totalChars: number }
  >();
  const owner = opts.ownerEmail || "anonymous";

  for (let i = 0; i < opts.attachments.length; i++) {
    const att = opts.attachments[i];
    if (!att.text || att.text.length === 0) continue;
    if (!isTextLikeMimeType(att.contentType) && !isTextLikeFilename(att.name)) {
      continue;
    }

    const text =
      att.text.length > MAX_ATTACHMENT_RESOURCE_BYTES
        ? att.text.slice(0, MAX_ATTACHMENT_RESOURCE_BYTES)
        : att.text;

    const path = attachmentResourcePath(
      opts.threadId,
      att.name || "attachment",
      i,
    );

    try {
      const resource = await resourcePut(
        owner,
        path,
        text,
        att.contentType || "text/plain",
        {
          createdBy: "user",
          visibility: "agent_scratch",
          threadId: opts.threadId,
          // 7-day TTL — long enough for multi-session threads.
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        },
      );
      result.set(i, {
        resourceId: resource.id,
        path,
        totalChars: text.length,
      });
    } catch (err) {
      // Best-effort: if storage fails the agent still gets the truncated
      // context and the read-attachment call will return a not-found error.
      console.warn(
        "[agent-native] persistTextAttachmentsAsResources failed:",
        err instanceof Error ? err.message : String(err),
      );
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
          "Read a slice of a large text attachment (CSV, code, JSON, markdown, plain text) that was",
          "truncated in the conversation context. Use this when the initial context showed a truncated",
          "attachment and you need to read more of it.",
          "",
          "Identify the attachment by name (e.g. name='data.csv') exactly as shown in the",
          "<attachment name='...'> tag in the conversation. Use offset and limit to page through it.",
          "",
          "Returns { content, offset, limit, totalChars, hasMore }.",
          "If totalChars is unknown (attachment not stored as a resource), returns a not-found message.",
        ].join("\n"),
        parameters: {
          type: "object" as const,
          properties: {
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
              description: `Maximum characters to return. Default: ${DEFAULT_SLICE_LIMIT}.`,
            },
          },
          required: ["name"],
        },
      },
      run: async (input: Record<string, string>, ctx) => {
        const ownerEmail =
          ctx?.userEmail || getRequestUserEmail() || "anonymous";
        const name = String(input.name || "").trim();
        const offset = Math.max(0, parseInt(input.offset || "0", 10) || 0);
        const limit = Math.min(
          50_000,
          Math.max(
            1,
            parseInt(input.limit || String(DEFAULT_SLICE_LIMIT), 10) ||
              DEFAULT_SLICE_LIMIT,
          ),
        );

        if (!name) {
          return { error: "name is required" };
        }

        // Determine threadId — from input or from turn-scoped run context.
        let threadId = String(input.threadId || "").trim();
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

        // Search the owner's resources for an attachment matching the name.
        try {
          const prefix = `attachments/${threadId}/`;
          const metas = await resourceList(ownerEmail, prefix, {
            includeAgentScratch: true,
          });

          // Find by name suffix match (the path ends with <index>-<safe-name>).
          const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
          const matching = metas.filter((m) => m.path.endsWith(`-${safeName}`));

          // If no exact match, try a partial search on the raw name.
          const candidates =
            matching.length > 0
              ? matching
              : metas.filter((m) => {
                  const basename = m.path.split("/").pop() || "";
                  // Strip the leading index prefix (<digits>-)
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

          // Use the first match (most recent upsert wins when there are
          // multiple same-name attachments in the same thread).
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
