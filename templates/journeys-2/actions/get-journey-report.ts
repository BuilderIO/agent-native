import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

const zero = () => ({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 });

export default defineAction({
  description: "Journey email report: delivery stats (sent, delivered, bounced, unsubscribed, opened, clicked) with rates, per-email breakdown, daily series, top links and email clients. Defaults to the last 30 days.",
  schema: z.object({
    id: z.string().min(1).describe("Journey id"),
    range: z.enum(["30d", "all"]).default("30d").describe("Timeframe: last 30 days or all time"),
  }),
  outputSchema: z.object({ report: z.record(z.string(), z.unknown()) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id, range }) => {
    await ready();
    const db = getDb();
    const [journey] = await db.select().from(schema.journeys).where(eq(schema.journeys.id, id));
    if (!journey) return errors.noWrite("Journey not found.", "not_found", { statusCode: 404 });
    const [rows, emails] = await Promise.all([
      db.select().from(schema.sends).where(eq(schema.sends.journeyId, id)),
      db.select().from(schema.emails),
    ]);
    const cutoff = new Date(Date.now() - (range === "30d" ? 30 : 36500) * 86400000).toISOString().slice(0, 10);
    const inRange = rows.filter((r) => r.day >= cutoff);
    const totals = zero();
    const perEmail = new Map<string, ReturnType<typeof zero>>();
    const daily = new Map<string, ReturnType<typeof zero>>();
    for (const r of inRange) {
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[key] += r[key];
        const e = perEmail.get(r.emailId) ?? zero(); e[key] += r[key]; perEmail.set(r.emailId, e);
        const d = daily.get(r.day) ?? zero(); d[key] += r[key]; daily.set(r.day, d);
      }
    }
    const names = new Map(emails.map((e) => [e.id, e.name]));
    const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
    return {
      report: {
        journey: { id: journey.id, name: journey.name, status: journey.status, entered: journey.entered, exited: journey.exited },
        range, totals,
        rates: { delivered: rate(totals.delivered, totals.sent), opened: rate(totals.opened, totals.delivered), clicked: rate(totals.clicked, totals.delivered), bounced: rate(totals.bounced, totals.sent), unsubscribed: rate(totals.unsubscribed, totals.delivered) },
        perEmail: [...perEmail].map(([emailId, t]) => ({ emailId, name: names.get(emailId) ?? emailId, ...t, openRate: rate(t.opened, t.delivered), clickRate: rate(t.clicked, t.delivered) })),
        daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([day, t]) => ({ day, ...t })),
        ...(journey.report as object),
      },
    };
  },
});
