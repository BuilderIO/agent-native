import { defineAction, embedApp } from "@agent-native/core";
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
    if (!action)
      throw new Error(
        "--action is required (create, update, delete, delete-all)",
      );

    if (action === "delete-all") {
      const count = await deleteAppStateByPrefix("compose-");
      return `Deleted ${count} draft(s)`;
    }

    if (action === "delete") {
      if (!args.id) throw new Error("--id is required for delete");
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) throw new Error(`Invalid draft ID "${args.id}"`);
      const deleted = await deleteAppState(`compose-${safeId}`);
      if (!deleted) throw new Error(`Draft "${safeId}" not found`);
      return `Deleted draft ${safeId}`;
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
      if (!args.id) throw new Error("--id is required for update");
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) throw new Error(`Invalid draft ID "${args.id}"`);
      const draft = await readAppState(`compose-${safeId}`);
      if (!draft) throw new Error(`Draft "${safeId}" not found`);
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
      await writeAppState(`compose-${safeId}`, draft);
      return {
        id: safeId,
        draft,
        deepLink: composeDeepLink(draft as Record<string, string>),
        message: `Updated draft ${safeId}`,
      };
    }

    throw new Error(
      `Unknown action "${action}". Valid: create, update, delete, delete-all`,
    );
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
