/**
 * disconnect-calendar
 *
 * Best-effort revokes Google tokens, deletes the secrets from
 * `app_secrets`, and removes the `calendar_accounts` row + any
 * `calendar_events` we synced for it. Access is enforced via
 * `assertAccess` so you can only disconnect accounts you own (or have
 * admin rights on).
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { deleteAppSecret, readAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { revokeToken } from "../server/lib/google-calendar-client.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Disconnect a calendar account. Revokes the Google tokens (best-effort), deletes secrets, and removes synced events.",
  schema: z.object({
    id: z.string().describe("calendar_accounts.id"),
  }),
  run: async (args) => {
    await assertAccess("calendar-account", args.id, "admin");
    const db = getDb();
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Not authenticated.");
    }

    const [account] = await db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, args.id));
    if (!account) throw new Error(`Calendar account not found: ${args.id}`);

    // Best-effort revoke of any live access/refresh tokens.
    try {
      if (account.refreshTokenSecretRef) {
        const ref = await readAppSecret({
          key: account.refreshTokenSecretRef,
          scope: "user",
          scopeId: userEmail,
        });
        if (ref?.value) await revokeToken(ref.value);
      } else if (account.accessTokenSecretRef) {
        const ref = await readAppSecret({
          key: account.accessTokenSecretRef,
          scope: "user",
          scopeId: userEmail,
        });
        if (ref?.value) {
          try {
            const parsed = JSON.parse(ref.value) as { accessToken?: string };
            if (parsed.accessToken) await revokeToken(parsed.accessToken);
          } catch {
            // Stored as raw token (older shape) — try directly.
            await revokeToken(ref.value);
          }
        }
      }
    } catch {
      // Non-fatal — we still want to delete the row.
    }

    // Drop the secrets.
    if (account.accessTokenSecretRef) {
      await deleteAppSecret({
        key: account.accessTokenSecretRef,
        scope: "user",
        scopeId: userEmail,
      }).catch(() => {});
    }
    if (account.refreshTokenSecretRef) {
      await deleteAppSecret({
        key: account.refreshTokenSecretRef,
        scope: "user",
        scopeId: userEmail,
      }).catch(() => {});
    }

    // Drop the synced events for this account so the meetings tab clears.
    await db
      .delete(schema.calendarEvents)
      .where(eq(schema.calendarEvents.calendarAccountId, args.id));

    // Drop the account row itself.
    await db
      .delete(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, disconnected: true };
  },
});
