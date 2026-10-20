import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { assignRoundRobin, type HostMetrics } from "../core/round-robin.js";
import { countBookingsByHostInRange } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";
import type { Host } from "../shared/index.js";

export default defineAction({
  description:
    "Select the next host for a round-robin event type based on recent booking load",
  schema: z.object({
    eventTypeId: z.string(),
    strategy: z
      .enum(["lowest-recent-bookings", "weighted", "calibrated"])
      .default("lowest-recent-bookings"),
  }),
  run: async (args) => {
    const eventTypeAccess = await assertAccess(
      "event-type",
      args.eventTypeId,
      "viewer",
    );
    const { getDb, schema } = getSchedulingContext();
    const hostRows = await getDb()
      .select()
      .from(schema.eventTypeHosts)
      .where(eq(schema.eventTypeHosts.eventTypeId, args.eventTypeId));
    const hosts: Host[] = hostRows.map((r: any) => ({
      userEmail: r.userEmail,
      eventTypeId: r.eventTypeId,
      isFixed: Boolean(r.isFixed),
      weight: r.weight,
      priority: r.priority,
      scheduleId: r.scheduleId ?? undefined,
    }));
    const windowDays = 30;
    const now = new Date();
    const from = new Date(now.getTime() - windowDays * 86400_000).toISOString();
    const to = now.toISOString();
    const metrics = new Map<string, HostMetrics>();
    for (const h of hosts) {
      metrics.set(h.userEmail, {
        recentBookingCount: await countBookingsByHostInRange(
          args.eventTypeId,
          h.userEmail,
          from,
          to,
          eventTypeAccess.resource.orgId,
        ),
        noShowRate: 0,
      });
    }
    const chosen = assignRoundRobin({
      hosts,
      metrics,
      strategy: args.strategy,
    });
    return { hostEmail: chosen?.userEmail ?? null };
  },
});
