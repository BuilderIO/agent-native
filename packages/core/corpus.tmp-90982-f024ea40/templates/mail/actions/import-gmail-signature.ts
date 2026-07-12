import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { googleFetch } from "../server/lib/google-api.js";
import { htmlSignatureToMarkdown } from "../shared/gmail-signature.js";
import type { UserSettings } from "../shared/types.js";
import { getAccessTokens } from "./helpers.js";

type SendAsEntry = {
  sendAsEmail?: string;
  displayName?: string;
  isPrimary?: boolean;
  signature?: string;
};

async function readGmailSignature(accessToken: string, account: string) {
  const sendAs = await googleFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    accessToken,
  );
  const entries = (sendAs?.sendAs ?? []) as SendAsEntry[];
  return (
    entries.find(
      (entry) => entry.sendAsEmail?.toLowerCase() === account.toLowerCase(),
    ) ??
    entries.find((entry) => entry.isPrimary) ??
    entries[0] ??
    null
  );
}

export default defineAction({
  description:
    "Import the user's configured Gmail signature into Mail drafting settings. Converts Gmail's HTML signature into compose-friendly Markdown while preserving text and links.",
  schema: z.object({
    account: z
      .string()
      .optional()
      .describe("Connected Gmail account email to import from"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const accounts = await getAccessTokens();
    if (accounts.length === 0) {
      throw new Error("Connect Gmail before importing a signature.");
    }

    const account = args.account
      ? accounts.find((candidate) => candidate.email === args.account)
      : accounts[0];
    if (!account) {
      throw new Error(`Account ${args.account} is not connected.`);
    }

    const sendAs = await readGmailSignature(account.accessToken, account.email);
    const signatureHtml =
      typeof sendAs?.signature === "string" ? sendAs.signature : "";
    const signature = htmlSignatureToMarkdown(signatureHtml);

    const current =
      ((await getUserSetting(ownerEmail, "mail-settings")) as
        | Partial<UserSettings>
        | undefined) ?? {};
    const next: Partial<UserSettings> = {
      ...current,
      email: current.email || ownerEmail,
      ...(sendAs?.displayName && !current.name
        ? { name: sendAs.displayName }
        : {}),
      signature,
    };

    await putUserSetting(ownerEmail, "mail-settings", next);

    return {
      account: account.email,
      signature,
      imported: signature.length > 0,
    };
  },
});
