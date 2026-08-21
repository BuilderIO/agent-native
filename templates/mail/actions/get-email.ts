import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { gmailGetMessage } from "../server/lib/google-api.js";
import { isConnected, gmailToEmailMessage } from "../server/lib/google-auth.js";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";

const accountCoordinate = z.union([z.string().email(), z.literal("local")]);

export default defineAction({
  description:
    "Read one exact email, including its full body and metadata, without changing UNREAD or any other mailbox label.",
  schema: z.object({
    accountEmail: accountCoordinate.describe(
      'Connected account email, or "local" for the synthetic mailbox',
    ),
    id: z.string().min(1).describe("Provider-scoped email message ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args, ctx) => {
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
      const found = emails.find(
        (e: any) =>
          e.id === args.id &&
          (e.accountEmail?.toLowerCase() ?? "local") === requestedAccount,
      );
      if (!found) throw new Error("Email not found.");
      const email = { ...found, accountEmail: args.accountEmail };
      return JSON.stringify(
        ctx?.caller === "mcp"
          ? {
              accountEmail: args.accountEmail,
              email,
              readOnlyGuarantee: {
                mailboxLabels: "preserved",
                gmailModifyOperations: 0,
              },
            }
          : email,
        null,
        2,
      );
    }

    const accounts = await getAccessTokens();
    const account = accounts.find(
      ({ email }) => email.toLowerCase() === requestedAccount,
    );
    if (!account) throw new Error("Requested Google account is not connected.");

    try {
      const labelMap = await fetchLabelMap(account.accessToken);
      const msg = await gmailGetMessage(account.accessToken, args.id, "full");
      const email = gmailToEmailMessage(msg, account.email, labelMap);
      return JSON.stringify(
        ctx?.caller === "mcp"
          ? {
              accountEmail: account.email,
              email,
              readOnlyGuarantee: {
                mailboxLabels: "preserved",
                gmailModifyOperations: 0,
              },
            }
          : email,
        null,
        2,
      );
    } catch (err: any) {
      if (err?.message?.includes("404")) throw new Error("Email not found.");
      throw new Error(err?.message ?? "Gmail API error");
    }
  },
});
