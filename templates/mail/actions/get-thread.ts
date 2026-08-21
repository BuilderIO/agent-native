import { defineAction } from "@agent-native/core";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { gmailGetThread } from "../server/lib/google-api.js";
import { gmailToEmailMessage, isConnected } from "../server/lib/google-auth.js";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

const accountCoordinate = z.union([z.string().email(), z.literal("local")]);

export default defineAction({
  description:
    "Read one exact email thread without changing UNREAD or any other mailbox label.",
  schema: z.object({
    accountEmail: accountCoordinate.describe(
      'Connected account email, or "local" for the synthetic mailbox',
    ),
    id: z.string().min(1).describe("Provider-scoped email thread ID"),
    compact: cliBoolean.optional().describe("Set to true for compact summary"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ args }) => {
    const threadId = typeof args?.id === "string" ? args.id : undefined;
    if (!threadId) return null;
    return {
      url: buildDeepLink({
        app: "mail",
        view: "inbox",
        params: { threadId },
      }),
      label: "Open thread in Mail",
      view: "inbox",
    };
  },
  run: async (args, ctx) => {
    const compact = args.compact === true;
    const requestedAccount = args.accountEmail.toLowerCase();

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      const localAccounts = new Set(
        emails.map(
          (email: any) => email.accountEmail?.toLowerCase() ?? "local",
        ),
      );
      if (!localAccounts.has(requestedAccount)) {
        throw new Error("Requested local account is not connected.");
      }
      const messages = emails
        .filter(
          (e: any) =>
            e.threadId === args.id &&
            (e.accountEmail?.toLowerCase() ?? "local") === requestedAccount,
        )
        .sort(
          (a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      if (messages.length === 0) throw new Error("Thread not found.");
      const result = compact
        ? messages.map((m: any) => ({
            id: m.id,
            from: m.from.name
              ? `${m.from.name} <${m.from.email}>`
              : m.from.email,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
          }))
        : messages;
      return JSON.stringify(
        ctx?.caller === "mcp"
          ? {
              accountEmail: args.accountEmail,
              messages: result,
              readOnlyGuarantee: {
                mailboxLabels: "preserved",
                gmailModifyOperations: 0,
              },
            }
          : result,
        null,
        2,
      );
    }

    const accounts = await getAccessTokens();
    const account = accounts.find(
      ({ email }) => email.toLowerCase() === requestedAccount,
    );
    if (!account) throw new Error("Requested Google account is not connected.");

    const labelMap = await fetchLabelMap(account.accessToken);

    try {
      const threadRes = await gmailGetThread(
        account.accessToken,
        args.id,
        "full",
      );
      const messages = (threadRes.messages || [])
        .map((m: any) =>
          gmailToEmailMessage(
            { ...m, _accountEmail: account.email },
            account.email,
            labelMap,
          ),
        )
        .sort(
          (a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

      const result = compact
        ? messages.map((m: any) => ({
            id: m.id,
            from: m.from.name
              ? `${m.from.name} <${m.from.email}>`
              : m.from.email,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
          }))
        : messages;

      return JSON.stringify(
        ctx?.caller === "mcp"
          ? {
              accountEmail: account.email,
              messages: result,
              readOnlyGuarantee: {
                mailboxLabels: "preserved",
                gmailModifyOperations: 0,
              },
            }
          : result,
        null,
        2,
      );
    } catch (err: any) {
      if (err?.message?.includes("404")) throw new Error("Thread not found.");
      throw new Error(err?.message ?? "Gmail API error");
    }
  },
});
