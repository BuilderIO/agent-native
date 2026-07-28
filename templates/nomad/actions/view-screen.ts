/**
 * See what the user is currently looking at on screen.
 *
 * Returns the current navigation state plus a compact compliance summary so
 * the agent has presence context (where the user is, which rules are hot)
 * without a second tool call.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { rules, stays, visas } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";
import { getProfile } from "../server/lib/profile.js";
import { computeSnapshot } from "../shared/compliance.js";
import type { Rule, Stay, Visa } from "../shared/types.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state (view, path, selected country) plus a compact compliance summary: current location, rule severities, and alert count. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    try {
      const owner = requireOwner();
      const db = getDb();
      const [stayRows, ruleRows, visaRows, profile] = await Promise.all([
        db.select().from(stays).where(eq(stays.ownerEmail, owner)),
        db.select().from(rules).where(eq(rules.ownerEmail, owner)),
        db.select().from(visas).where(eq(visas.ownerEmail, owner)),
        getProfile(),
      ]);
      const snapshot = computeSnapshot(
        stayRows as Stay[],
        ruleRows as Rule[],
        profile,
        undefined,
        visaRows as Visa[],
      );
      screen.compliance = {
        today: snapshot.today,
        currentLocation: snapshot.currentLocation,
        citizenshipCountry: snapshot.profile.citizenshipCountry,
        immigrationStatus: snapshot.profile.immigrationStatus,
        fiscalHomeCountry: snapshot.profile.fiscalHomeCountry,
        onboardingCompleted: snapshot.profile.onboardingCompleted,
        alertCount: snapshot.alerts.length,
        visas: snapshot.visas.map((vc) => ({
          id: vc.visa.id,
          label: vc.visa.label,
          expiresOn: vc.visa.expiresOn,
          daysUntilExpiry: vc.daysUntilExpiry,
          severity: vc.severity,
        })),
        pendingStayCount: snapshot.pendingStays.length,
        rules: snapshot.rules.map((rc) => ({
          id: rc.rule.id,
          name: rc.rule.name,
          usedDays: rc.usedDays,
          limitDays: rc.limitDays,
          severity: rc.severity,
          statusKey: rc.statusKey,
          mustExitBy: rc.mustExitBy,
        })),
      };
    } catch {
      // Screen context should never fail hard if the DB is unavailable.
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
