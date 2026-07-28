import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { stays } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";
import { getProfile, saveProfile } from "../server/lib/profile.js";

/**
 * Simulated weekly inbox scan.
 *
 * In a full deployment this is where an A2A call to a connected Mail app
 * parses flight/hotel confirmations into `pending` stays (see AGENTS.md →
 * "Inbox scan"). The template ships without a mail credential, so this action
 * records the scan and reports the pending stays already in the ledger; the
 * user (or agent) confirms them with upsert-stay { id, status: "confirmed" }.
 */
export default defineAction({
  description:
    "Run the inbox scan now: refresh the last-scanned timestamp and return inbox-detected stays still awaiting confirmation. Confirm a detected stay with upsert-stay { id, status: 'confirmed' } or discard it with delete-stay. (Template note: booking parsing is stubbed until a Mail app is connected over A2A.)",
  schema: z.object({}),
  run: async () => {
    const profile = await getProfile();
    if (!profile.mailScanEnabled) {
      return {
        scanned: false,
        reason:
          "Inbox scanning is disabled in the profile. Enable it with update-profile { mailScanEnabled: true }.",
      };
    }
    const lastScanAt = new Date().toISOString();
    await saveProfile({ lastScanAt });
    const db = getDb();
    const pending = await db
      .select()
      .from(stays)
      .where(
        and(eq(stays.ownerEmail, requireOwner()), eq(stays.status, "pending")),
      );
    return { scanned: true, lastScanAt, pendingStays: pending };
  },
});
