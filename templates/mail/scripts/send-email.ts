/**
 * Send an email via Gmail.
 *
 * Usage:
 *   pnpm script send-email --to=alice@example.com --subject="Hello" --body="Hi there"
 *   pnpm script send-email --to=alice@example.com --cc=bob@example.com --subject="Update" --body="..."
 *   pnpm script send-email --to=alice@example.com --subject="Re: Thread" --body="..." --replyToId=msg-456
 *
 * Options:
 *   --to          Recipient email(s), comma-separated (required)
 *   --cc          CC email(s), comma-separated
 *   --bcc         BCC email(s), comma-separated
 *   --subject     Email subject (required)
 *   --body        Email body text (required)
 *   --replyToId   Message ID being replied to (for threading)
 *   --account     Specific account to send from (optional)
 */

import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { parseArgs, output, fatal } from "./helpers.js";
import { getClients, getClient } from "../server/lib/google-auth.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Send an email via Gmail.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email(s), comma-separated" },
      subject: { type: "string", description: "Email subject" },
      body: { type: "string", description: "Email body text" },
      cc: { type: "string", description: "CC email(s), comma-separated" },
      bcc: { type: "string", description: "BCC email(s), comma-separated" },
      replyToId: {
        type: "string",
        description: "Message ID being replied to (for threading)",
      },
      account: {
        type: "string",
        description: "Specific account email to send from",
      },
    },
    required: ["to", "subject", "body"],
  },
};

function buildRawEmail(opts: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    opts.body,
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function readSettings(): { name: string; email: string } {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "data", "settings.json"),
        "utf-8",
      ),
    );
  } catch {
    return { name: "", email: "" };
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.to) return "Error: --to is required";
  if (!args.subject) return "Error: --subject is required";
  if (!args.body) return "Error: --body is required";

  const settings = readSettings();
  const clients = await getClients();
  if (clients.length === 0) return "Error: No Google account connected.";

  let selectedClient = clients[0].client;
  let selectedEmail = clients[0].email;

  if (args.account) {
    const match = clients.find((c) => c.email === args.account);
    if (!match) return `Error: Account ${args.account} not connected`;
    selectedClient = match.client;
    selectedEmail = match.email;
  }

  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (args.replyToId) {
    for (const { email, client } of clients) {
      try {
        const gmail = google.gmail({ version: "v1", auth: client });
        const original = await gmail.users.messages.get({
          userId: "me",
          id: args.replyToId,
          format: "metadata",
          metadataHeaders: ["Message-Id", "References"],
        });
        threadId = original.data.threadId ?? undefined;
        const headers = original.data.payload?.headers || [];
        inReplyTo =
          headers.find((h) => h.name === "Message-Id")?.value ?? undefined;
        const refs = headers.find((h) => h.name === "References")?.value;
        references = [refs, inReplyTo].filter(Boolean).join(" ");
        if (!args.account) {
          selectedClient = client;
          selectedEmail = email;
        }
        break;
      } catch {}
    }
  }

  const raw = buildRawEmail({
    from: settings.name ? `${settings.name} <${selectedEmail}>` : selectedEmail,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    body: args.body,
    inReplyTo,
    references,
  });

  const requestBody: any = { raw };
  if (threadId) requestBody.threadId = threadId;

  const gmail = google.gmail({ version: "v1", auth: selectedClient });
  try {
    const sent = await (gmail.users.messages.send as any)({
      userId: "me",
      requestBody,
    });
    return `Email sent successfully (id: ${sent.data.id})`;
  } catch (err: any) {
    return `Error sending email: ${err?.message}`;
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.to) fatal("--to is required");
  if (!args.subject) fatal("--subject is required");
  if (!args.body) fatal("--body is required");
  const result = await run(args);
  console.error(result);
  output({ result });
}
