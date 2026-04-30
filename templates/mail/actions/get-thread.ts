import { defineAction } from "@agent-native/core";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { gmailGetThread } from "../server/lib/google-api.js";
import { gmailToEmailMessage, isConnected } from "../server/lib/google-auth.js";
import { z } from "zod";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export default defineAction({
  description: "Get all messages in an email thread by thread ID.",
  schema: z.object({
    id: z.string().optional().describe("Thread ID"),
    compact: cliBoolean.optional().describe("Set to true for compact summary"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) return "Error: --id is required";
    const compact = args.compact === true;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      const messages = emails
        .filter((e: any) => e.threadId === args.id)
        .sort(
          (a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      if (messages.length === 0) return "Error: Thread not found.";
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
      return JSON.stringify(result, null, 2);
    }

    const accounts = await getAccessTokens();
    if (accounts.length === 0) return "Error: No Google account connected.";

    const labelMap = new Map<string, string>();
    await Promise.all(
      accounts.map(async ({ accessToken }) => {
        try {
          const map = await fetchLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    for (const { email, accessToken } of accounts) {
      try {
        const threadRes = await gmailGetThread(accessToken, args.id, "full");
        const messages = (threadRes.messages || [])
          .map((m: any) =>
            gmailToEmailMessage(
              { ...m, _accountEmail: email },
              email,
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

        return JSON.stringify(result, null, 2);
      } catch (err: any) {
        if (err?.message?.includes("404")) continue;
        return `Error: ${err?.message}`;
      }
    }
    return "Error: Thread not found in any connected account.";
  },
});
