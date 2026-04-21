import { defineAction } from "@agent-native/core";

export default defineAction({
  description:
    "Start or renew a Gmail push-notification watch for every connected Google account. Normally the 12h renewal cron handles this; run this manually to bootstrap immediately after enabling push (GMAIL_WATCH_TOPIC) or to recover from a lapsed watch.",
  http: false,
  run: async () => {
    if (!process.env.GMAIL_WATCH_TOPIC) {
      return "Skipped: GMAIL_WATCH_TOPIC is not set. Push notifications are not configured in this environment.";
    }

    const { listOAuthAccounts } =
      await import("@agent-native/core/oauth-tokens");
    const { getClientForAccount, startWatch } =
      await import("../server/lib/google-auth.js");

    const accounts = await listOAuthAccounts("google");
    if (accounts.length === 0) {
      return "No connected Google accounts found.";
    }

    const results: string[] = [];
    let ok = 0;
    let failed = 0;
    for (const acc of accounts) {
      try {
        const client = await getClientForAccount(acc.accountId);
        if (!client) {
          failed += 1;
          results.push(`  ${acc.accountId}: no valid token (skipped)`);
          continue;
        }
        const res = await startWatch(client.accessToken);
        if (res) {
          ok += 1;
          const expiresAt = new Date(Number(res.expiration)).toISOString();
          results.push(
            `  ${acc.accountId}: ok (historyId=${res.historyId}, expires=${expiresAt})`,
          );
        } else {
          failed += 1;
          results.push(`  ${acc.accountId}: startWatch returned null`);
        }
      } catch (err: any) {
        failed += 1;
        results.push(`  ${acc.accountId}: ${err.message}`);
      }
    }

    return [
      `Bootstrapped Gmail watches: ${ok} ok, ${failed} failed, ${accounts.length} total`,
      ...results,
    ].join("\n");
  },
});
