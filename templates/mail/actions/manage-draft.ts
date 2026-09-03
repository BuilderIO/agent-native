import { embedApp } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { saveGmailDraft } from "../server/lib/gmail-drafts.js";
import { appendSignatureToBody } from "../shared/signature.js";

const COMPOSE_FULLSCREEN_PARAM = "composeFullscreen";

/**
 * Deep link that reopens a compose draft in the Mail compose panel.
 *
 * The link is an opaque pointer (draft id only). The full draft — subject,
 * recipients, body — lives in the `compose-{id}` app-state row written by
 * this action, so the compose panel reads it from there on render. We
 * deliberately do NOT inline the draft contents into the URL: external MCP
 * hosts (ChatGPT / Claude) surface this link in their UI, the host LLM can
 * see and remember query strings, and shared / exported chat transcripts
 * would otherwise leak private draft content.
 */
function composeDeepLink(draft: Record<string, string>): string {
  return buildDeepLink({
    app: "mail",
    view: "inbox",
    to: `/inbox?${COMPOSE_FULLSCREEN_PARAM}=1`,
    params: { composeDraftId: draft.id },
  });
}

/** Reject IDs that could escape via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

const draftFields = {
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
};

const draftId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .describe("Draft ID");

const manageDraftSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create").describe("Create a new draft"),
    id: draftId.optional().describe("Optional caller-provided draft ID"),
    ...draftFields,
  }),
  z.object({
    action: z.literal("update").describe("Update an existing draft"),
    id: draftId,
    ...draftFields,
  }),
  z.object({
    action: z.literal("delete").describe("Delete one draft"),
    id: draftId,
  }),
  z.object({
    action: z.literal("delete-all").describe("Delete all compose drafts"),
  }),
]);

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
  schema: manageDraftSchema,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Review email draft",
      description:
        "Open the generated draft in the real Mail compose UI with contact autocomplete, aliases, formatting, attachments, and sending controls.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
      height: 900,
    }),
  },
  run: async (args) => {
    const action = args.action;

    if (action === "delete-all") {
      const count = await deleteAppStateByPrefix("compose-");
      return `Deleted ${count} draft(s)`;
    }

    if (action === "delete") {
      const safeId = sanitizeDraftId(args.id);
      if (!safeId)
        fail(`Invalid draft ID "${args.id}"`, {
          errorCode: "draft_invalid_id",
        });
      const deleted = await deleteAppState(`compose-${safeId}`);
      if (!deleted)
        fail(`Draft "${safeId}" not found`, {
          errorCode: "draft_not_found",
          statusCode: 404,
        });
      return `Deleted draft ${safeId}`;
    }

    if (action === "create") {
      const rawId = args.id || `draft-${Date.now()}`;
      const id = sanitizeDraftId(rawId);
      if (!id)
        fail(`Invalid draft ID "${rawId}"`, {
          errorCode: "draft_invalid_id",
        });
      const signature = await readConfiguredSignature();
      const ownerEmail = getRequestUserEmail();
      const body = appendSignatureToBody(args.body || "", signature);
      const savedGmailDraft = ownerEmail
        ? await saveGmailDraft({
            ownerEmail,
            accountEmail: args.accountEmail,
            to: args.to || "",
            cc: args.cc,
            bcc: args.bcc,
            subject: args.subject || "",
            body,
          })
        : null;
      const draft: Record<string, string> = {
        id,
        to: args.to || "",
        subject: args.subject || "",
        body,
        mode: args.mode || "compose",
        ...(savedGmailDraft ? { savedDraftId: savedGmailDraft.draftId } : {}),
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
      const safeId = sanitizeDraftId(args.id);
      if (!safeId)
        fail(`Invalid draft ID "${args.id}"`, {
          errorCode: "draft_invalid_id",
        });
      const storedDraft = await readAppState(`compose-${safeId}`);
      if (!storedDraft)
        fail(`Draft "${safeId}" not found`, {
          errorCode: "draft_not_found",
          statusCode: 404,
        });
      if (typeof storedDraft !== "object" || Array.isArray(storedDraft)) {
        throw new Error(`Draft "${safeId}" has invalid stored data`);
      }
      const draft = Object.fromEntries(
        Object.entries(storedDraft).map(([key, value]) => {
          if (typeof value !== "string") {
            throw new Error(`Draft "${safeId}" has invalid ${key}`);
          }
          return [key, value];
        }),
      ) as Record<string, string>;
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
        if ((args as any)[key] !== undefined)
          (draft as any)[key] = (args as any)[key];
      }
      const ownerEmail = getRequestUserEmail();
      const savedGmailDraft = ownerEmail
        ? await saveGmailDraft({
            ownerEmail,
            accountEmail: draft.accountEmail,
            draftId: draft.savedDraftId,
            to: draft.to || "",
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject || "",
            body: draft.body || "",
          })
        : null;
      if (savedGmailDraft) draft.savedDraftId = savedGmailDraft.draftId;
      await writeAppState(`compose-${safeId}`, draft);
      return {
        id: safeId,
        draft,
        deepLink: composeDeepLink(draft as Record<string, string>),
        message: `Updated draft ${safeId}`,
      };
    }

    return fail(`Unknown action "${String(action)}"`, {
      errorCode: "draft_action_invalid",
    });
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
