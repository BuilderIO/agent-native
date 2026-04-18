import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";
import { countBookingsByHostInRange } from "../server/bookings-repo.js";
import { assignRoundRobin, type HostMetrics } from "../core/round-robin.js";
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
          h.userEmail,
          from,
          to,
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
