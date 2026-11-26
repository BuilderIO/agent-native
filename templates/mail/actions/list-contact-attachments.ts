import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { assertGmailNotCoolingDown } from "../server/lib/gmail-quota.js";
import { GmailQuotaCooldownError } from "../server/lib/google-api.js";
import {
  getClientsWithErrors,
  gmailToEmailMessage,
  isConnected,
  listGmailMessages,
} from "../server/lib/google-auth.js";
import { retryAfterSecondsFromErrors } from "../server/lib/list-inbox-emails.js";
import type {
  ContactAttachment,
  ContactAttachmentList,
  EmailMessage,
} from "../shared/types.js";

function attachmentsOf(emails: EmailMessage[], limit: number) {
  const items: ContactAttachment[] = [];
  const newestFirst = [...emails].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  for (const email of newestFirst) {
    for (const attachment of email.attachments ?? []) {
      items.push({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        emailId: email.id,
        threadId: email.threadId || email.id,
        subject: email.subject,
        date: email.date,
        ...(email.accountEmail ? { accountEmail: email.accountEmail } : {}),
      });
      if (items.length === limit) return items;
    }
  }
  return items;
}

export default defineAction({
  description:
    "List the files a person has sent the user, newest first, with the email each came in. Use it for 'what did Priya send me?' or to find a file by who sent it.",
  schema: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .describe("The person's email address"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Max files (default: 10)"),
  }),
  outputSchema: z.object({
    attachments: z.array(
      z.object({
        id: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        size: z.number(),
        emailId: z.string(),
        threadId: z.string(),
        subject: z.string(),
        date: z.string(),
        accountEmail: z.string().optional(),
      }),
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: async (args): Promise<ContactAttachmentList> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to see a person's files.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const limit = args.limit ?? 10;

    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails: EmailMessage[] =
        data && Array.isArray((data as { emails?: unknown }).emails)
          ? (data as { emails: EmailMessage[] }).emails
          : [];
      const fromContact = emails.filter(
        (email) =>
          !email.isTrashed &&
          email.from.email.trim().toLowerCase() === args.email,
      );
      return { attachments: attachmentsOf(fromContact, limit) };
    }

    const { clients, errors: clientErrors } =
      await getClientsWithErrors(ownerEmail);
    if (clientErrors.length > 0) {
      throw new Error(
        clientErrors
          .map((error) => `${error.email}: ${error.error}`)
          .join("; "),
      );
    }
    if (clients.length === 0) {
      fail("No Google account is connected.", {
        errorCode: "no_google_account",
        statusCode: 409,
      });
    }
    await assertGmailNotCoolingDown(clients.map((client) => client.email));

    const { messages, errors } = await listGmailMessages(
      `from:${args.email} has:attachment`,
      limit,
      ownerEmail,
    );
    if (errors.length > 0) {
      if (errors.every((error) => error.isQuotaError)) {
        throw new GmailQuotaCooldownError(
          retryAfterSecondsFromErrors(errors) * 1000,
        );
      }
      throw new Error(
        errors.map((error) => `${error.email}: ${error.error}`).join("; "),
      );
    }

    const emails: EmailMessage[] = messages.map((message) =>
      gmailToEmailMessage(message, message._accountEmail),
    );
    return { attachments: attachmentsOf(emails, limit) };
  },
});
