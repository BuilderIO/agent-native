import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { getUserSetting } from "@agent-native/core/settings";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";
import { appendSignatureToBody } from "../shared/signature.js";

/**
 * Cap for the base64url `compose=` query param. A full draft (recipients +
 * subject + entire body) base64-encoded can be many KB, and browsers / inline
 * webviews silently truncate or reject very long URLs. When the self-contained
 * payload would exceed this, we fall back to an id-only deep link: the draft
 * is already persisted as a `compose-{id}` app-state entry by this action, so
 * the compose panel resurfaces it from the persisted row for the creator. The
 * threshold is conservative (well under the ~8KB practical URL ceiling, with
 * headroom for the rest of the query string and host prefix).
 */
const MAX_COMPOSE_PAYLOAD_BYTES = 1536;

/** Base64url-encode a compose draft so `/_agent-native/open?compose=…`
 *  decodes it back into a `compose-{id}` app-state entry the compose panel
 *  auto-opens. */
function encodeComposeDraft(draft: Record<string, string>): string {
  return Buffer.from(JSON.stringify(draft)).toString("base64url");
}

/**
 * Build the compact `compose=` payload. Prefer the full self-contained draft
 * (so a small draft opens instantly with content even before app-state polls),
 * but if encoding the whole draft would blow the URL size budget, fall back to
 * an id-only payload. `manage-draft` always persists the full draft to the
 * `compose-{id}` app-state key, so the compose panel still resurfaces the
 * complete draft by id for the creator — the URL just stays short.
 */
function encodeComposePayload(draft: Record<string, string>): string {
  const full = encodeComposeDraft(draft);
  if (Buffer.byteLength(full, "utf8") <= MAX_COMPOSE_PAYLOAD_BYTES) {
    return full;
  }
  // Keep the id (required to resurface the persisted draft) plus a tiny
  // subject hint so the link is still self-describing; drop the heavy body.
  const compact: Record<string, string> = { id: draft.id };
  if (draft.subject) compact.subject = draft.subject.slice(0, 120);
  return encodeComposeDraft(compact);
}

/** Deep link that reopens a compose draft in the Mail compose panel. */
function composeDeepLink(draft: Record<string, string>): string {
  return buildDeepLink({
    app: "mail",
    view: "inbox",
    compose: encodeComposePayload(draft),
  });
}

/** Reject IDs that could escape via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

async function readConfiguredSignature(): Promise<string | undefined> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) return undefined;
  const settings = await getUserSetting(ownerEmail, "mail-settings");
  const signature = (settings as any)?.signature;
  return typeof signature === "string" ? signature : undefined;
}

export default defineAction({
  description:
    "Create, update, or delete a compose draft. Opening a draft makes it appear in the compose panel UI automatically.",
  schema: z.object({
    action: z
      .enum(["create", "update", "delete", "delete-all"])
      .optional()
      .describe("Action to perform"),
    id: z
      .string()
      .optional()
      .describe(
        "Draft ID (auto-generated for create; required for update/delete)",
      ),
    to: z.string().optional().describe("Recipient email(s)"),
    cc: z.string().optional().describe("CC email(s)"),
    bcc: z.string().optional().describe("BCC email(s)"),
    subject: z.string().optional().describe("Email subject"),
    body: z
      .string()
      .optional()
      .describe(
        "Email body in markdown. Use [text](url) for links, **bold**, *italic*, - lists, etc.",
      ),
    mode: z
      .enum(["compose", "reply", "forward"])
      .optional()
      .describe("compose, reply, or forward"),
    replyToId: z.string().optional().describe("Message ID being replied to"),
    replyToThreadId: z.string().optional().describe("Thread ID for grouping"),
    accountEmail: z
      .string()
      .optional()
      .describe("The 'from' account email address to send from"),
  }),
  run: async (args) => {
    const action = args.action;
    if (!action)
      return "Error: --action is required (create, update, delete, delete-all)";

    if (action === "delete-all") {
      const count = await deleteAppStateByPrefix("compose-");
      return `Deleted ${count} draft(s)`;
    }

    if (action === "delete") {
      if (!args.id) return "Error: --id is required for delete";
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
      const deleted = await deleteAppState(`compose-${safeId}`);
      return deleted
        ? `Deleted draft ${safeId}`
        : `Error: Draft "${safeId}" not found`;
    }

    if (action === "create") {
      const rawId = args.id || `draft-${Date.now()}`;
      const id = sanitizeDraftId(rawId) ?? `draft-${Date.now()}`;
      const signature = await readConfiguredSignature();
      const draft: Record<string, string> = {
        id,
        to: args.to || "",
        subject: args.subject || "",
        body: appendSignatureToBody(args.body || "", signature),
        mode: args.mode || "compose",
      };
      if (args.cc) draft.cc = args.cc;
      if (args.bcc) draft.bcc = args.bcc;
      if (args.replyToId) draft.replyToId = args.replyToId;
      if (args.replyToThreadId) draft.replyToThreadId = args.replyToThreadId;
      if (args.accountEmail) draft.accountEmail = args.accountEmail;
      await writeAppState(`compose-${id}`, draft);
      return {
        id,
        draft,
        deepLink: composeDeepLink(draft),
        message: `Created draft ${id}`,
      };
    }

    if (action === "update") {
      if (!args.id) return "Error: --id is required for update";
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
      const draft = await readAppState(`compose-${safeId}`);
      if (!draft) return `Error: Draft "${safeId}" not found`;
      for (const key of [
        "to",
        "cc",
        "bcc",
        "subject",
        "body",
        "mode",
        "replyToId",
        "replyToThreadId",
        "accountEmail",
      ]) {
        if (args[key] !== undefined) (draft as any)[key] = args[key];
      }
      await writeAppState(`compose-${safeId}`, draft);
      return {
        id: safeId,
        draft,
        deepLink: composeDeepLink(draft as Record<string, string>),
        message: `Updated draft ${safeId}`,
      };
    }

    return `Error: Unknown action "${action}". Valid: create, update, delete, delete-all`;
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const draft = (result as { draft?: Record<string, string> }).draft;
    const id = (result as { id?: string }).id;
    if (!draft || !id) return null;
    return {
      url: composeDeepLink(draft),
      label: "Open draft in Mail",
      view: "inbox",
    };
  },
});
