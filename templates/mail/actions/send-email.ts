import { defineAction } from "@agent-native/core";
import { getAccessTokens } from "./helpers.js";
import { z } from "zod";
import { nanoid } from "nanoid";
import { gmailGetMessage, gmailSendMessage } from "../server/lib/google-api.js";
import {
  getAccountDisplayName,
  invalidateListCacheForOwner,
  setAccountDisplayName,
} from "../server/lib/google-auth.js";
import { setOAuthDisplayName } from "@agent-native/core/oauth-tokens";
import {
  bodyToHtml,
  buildRawEmail,
  resolveComposeAttachments,
  splitReplyQuote,
} from "../server/lib/outgoing-email.js";
import { resolveGoogleSenderIdentity } from "../server/lib/sender-identity.js";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { emit } from "@agent-native/core/event-bus";
import {
  collectLinks,
  newClickToken,
  newPixelToken,
  persistTracking,
  type TrackingContext,
} from "../server/lib/email-tracking.js";
import { getAppProductionUrl } from "@agent-native/core/server";
import type { UserSettings } from "../shared/types.js";
import { markdownPreviewSnippet } from "../shared/markdown.js";

async function readSettings(): Promise<{
  name: string;
  email: string;
  tracking?: UserSettings["tracking"];
}> {
  const ownerEmail = getRequestUserEmail();
  const data = ownerEmail
    ? await getUserSetting(ownerEmail, "mail-settings")
    : undefined;
  if (data && typeof (data as any).name === "string") {
    const email = (data as any).email || ownerEmail || "";
    return {
      name: (data as any).name ?? "",
      email,
      tracking: (data as any).tracking,
    };
  }
  return { name: "", email: ownerEmail || "" };
}

function buildTrackingContext(
  body: string,
  tracking: UserSettings["tracking"],
): TrackingContext | undefined {
  const trackOpens = tracking?.opens === true;
  const trackClicks = tracking?.clicks === true;
  if (!trackOpens && !trackClicks) return undefined;

  const linkTokens = new Map<string, string>();
  if (trackClicks) {
    const split = splitReplyQuote(body);
    const portion = split ? split.newContent : body;
    for (const url of collectLinks(portion)) {
      linkTokens.set(url, newClickToken());
    }
  }

  return {
    pixelToken: newPixelToken(),
    linkTokens,
    trackOpens,
    trackClicks,
    appUrl: getAppProductionUrl(),
  };
}

const attachmentSchema = z.object({
  filename: z
    .string()
    .describe(
      "The stored upload filename (the server-side key, e.g. 'abc123.pdf'). Must match a file previously uploaded via the media-upload endpoint.",
    ),
  originalName: z
    .string()
    .optional()
    .describe("Display name shown to the recipient (e.g. 'Q2-Report.pdf')"),
  mimeType: z
    .string()
    .optional()
    .describe(
      "MIME type, e.g. 'application/pdf'. Inferred from the stored upload when omitted.",
    ),
});

export default defineAction({
  description:
    "Send an email via Gmail. IMPORTANT: Never call this unless the user explicitly asks to send — always draft first and show the content to the user for review before sending.",
  schema: z.object({
    to: z.string().describe("Recipient email(s), comma-separated"),
    subject: z.string().describe("Email subject"),
    body: z
      .string()
      .describe(
        "Email body in markdown. Use [text](url) for links, **bold**, *italic*, - lists, etc.",
      ),
    cc: z.string().optional().describe("CC email(s), comma-separated"),
    bcc: z.string().optional().describe("BCC email(s), comma-separated"),
    replyToId: z
      .string()
      .optional()
      .describe("Message ID being replied to (for threading)"),
    account: z
      .string()
      .optional()
      .describe("Specific account email to send from"),
    attachments: z
      .array(attachmentSchema)
      .optional()
      .describe(
        "Files to attach. Each entry must reference a previously-uploaded file by its server-side `filename`. The upload must have been created via the media-upload endpoint before calling this action.",
      ),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const settings = await readSettings();

    // Resolve attachments eagerly — fail before touching Gmail if any are missing.
    let resolvedAttachments: Awaited<
      ReturnType<typeof resolveComposeAttachments>
    > = [];
    if (args.attachments && args.attachments.length > 0) {
      try {
        resolvedAttachments = await resolveComposeAttachments(
          args.attachments,
          ownerEmail,
        );
      } catch {
        throw new Error(
          "One or more attachments could not be read. Make sure each file was uploaded via the media-upload endpoint before sending.",
        );
      }
    }

    const accounts = await getAccessTokens();
    if (accounts.length === 0) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      const newEmail = {
        id: `msg-${nanoid(8)}`,
        threadId: args.replyToId
          ? (emails.find((e: any) => e.id === args.replyToId)?.threadId ??
            `thread-${nanoid(8)}`)
          : `thread-${nanoid(8)}`,
        from: { name: settings.name, email: settings.email },
        to: args.to.split(",").map((value) => {
          const trimmed = value.trim();
          return { name: trimmed, email: trimmed };
        }),
        ...(args.cc
          ? {
              cc: args.cc.split(",").map((value) => {
                const trimmed = value.trim();
                return { name: trimmed, email: trimmed };
              }),
            }
          : {}),
        ...(args.bcc
          ? {
              bcc: args.bcc.split(",").map((value) => {
                const trimmed = value.trim();
                return { name: trimmed, email: trimmed };
              }),
            }
          : {}),
        subject: args.subject,
        snippet: markdownPreviewSnippet(args.body),
        body: args.body,
        bodyHtml: bodyToHtml(args.body),
        date: new Date().toISOString(),
        isRead: true,
        isStarred: false,
        isSent: true,
        isArchived: false,
        isTrashed: false,
        labelIds: ["sent"],
        ...(resolvedAttachments.length > 0
          ? {
              attachments: resolvedAttachments.map((att) => ({
                id: att.filename,
                filename: att.originalName,
                mimeType: att.mimeType,
                size: att.size,
                url: att.url,
              })),
            }
          : {}),
      };
      emails.push(newEmail);
      await putUserSetting(ownerEmail, "local-emails", { emails });
      try {
        emit(
          "mail.message.sent",
          {
            messageId: newEmail.id,
            to: args.to,
            subject: args.subject,
          },
          { owner: ownerEmail },
        );
      } catch {}
      return JSON.stringify(newEmail, null, 2);
    }

    let selectedToken = accounts[0].accessToken;
    let selectedEmail = accounts[0].email;

    if (args.account) {
      const match = accounts.find((a) => a.email === args.account);
      if (!match) throw new Error(`Account ${args.account} not connected`);
      selectedToken = match.accessToken;
      selectedEmail = match.email;
    }

    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;

    if (args.replyToId) {
      for (const { email, accessToken } of accounts) {
        try {
          const original = await gmailGetMessage(
            accessToken,
            args.replyToId,
            "metadata",
          );
          threadId = original.threadId ?? undefined;
          const headers = original.payload?.headers || [];
          inReplyTo =
            headers.find(
              (h: any) => h.name === "Message-Id" || h.name === "Message-ID",
            )?.value ?? undefined;
          const refs = headers.find((h: any) => h.name === "References")?.value;
          references = [refs, inReplyTo].filter(Boolean).join(" ");
          if (!args.account) {
            selectedToken = accessToken;
            selectedEmail = email;
          }
          break;
        } catch {}
      }
    }

    const senderIdentity = await resolveGoogleSenderIdentity({
      accessToken: selectedToken,
      email: selectedEmail,
      fallbackName: settings.name,
      cachedName: getAccountDisplayName(selectedEmail),
      onResolvedDisplayName: (name) => {
        setAccountDisplayName(selectedEmail, name);
        void setOAuthDisplayName("google", selectedEmail, name).catch(() => {});
      },
    });

    const tracking = buildTrackingContext(args.body, settings.tracking);

    const raw = buildRawEmail({
      from: senderIdentity.header,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
      inReplyTo,
      references,
      tracking,
      attachments:
        resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
    });

    try {
      const sent = await gmailSendMessage(selectedToken, raw, threadId);
      invalidateListCacheForOwner(ownerEmail);
      if (tracking && sent?.id) {
        await persistTracking({
          pixelToken: tracking.pixelToken,
          messageId: sent.id,
          ownerEmail: selectedEmail,
          sentAt: Date.now(),
          linkTokens: tracking.linkTokens,
        }).catch((err) =>
          console.error("[send-email] persistTracking failed:", err),
        );
      }
      // Emit mail.message.sent event (best-effort)
      try {
        emit(
          "mail.message.sent",
          {
            messageId: sent.id,
            to: args.to,
            subject: args.subject,
          },
          { owner: selectedEmail },
        );
      } catch {
        // best-effort — never block the send response
      }

      return `Email sent successfully (id: ${sent.id})`;
    } catch (err: any) {
      throw new Error(`sending email: ${err?.message}`);
    }
  },
});
