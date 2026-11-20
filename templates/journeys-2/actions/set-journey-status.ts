import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Publish (start), pause, resume or finish a journey. Publishing validates that every step is connected and email steps have an email.",
  schema: z.object({
    id: z.string().min(1).describe("Journey id"),
    action: z.enum(["publish", "pause", "resume", "finish"]).describe("publish: draft to active; pause: active to paused; resume: paused to active; finish: stop for good"),
  }),
  outputSchema: z.object({ id: z.string(), status: z.string() }),
  errors,
  run: async ({ id, action }) => {
    await ready();
    const [row] = await getDb().select().from(schema.journeys).where(eq(schema.journeys.id, id));
    if (!row) return errors.noWrite("Journey not found.", "not_found", { statusCode: 404 });
    const allowed: Record<string, string[]> = { publish: ["draft"], pause: ["active"], resume: ["paused"], finish: ["active", "paused"] };
    if (!allowed[action]!.includes(row.status))
      return errors.noWrite(`Cannot ${action} a journey that is ${row.status}.`, "conflict", { statusCode: 409 });
    if (action === "publish" || action === "resume") {
      const nodes = row.nodes as { id: string; type: string; label?: string; config: Record<string, unknown> }[];
      const edges = row.edges as { source: string; target: string }[];
      if (row.kind === "audience" && !row.audienceId)
        return errors.noWrite("Choose an audience before publishing.", "invalid_input");
      const connected = new Set(edges.flatMap((e) => [e.target]));
      const orphan = nodes.find((n) => n.type !== "trigger" && n.type !== "note" && !connected.has(n.id));
      if (orphan) return errors.noWrite(`Step "${orphan.label ?? orphan.type}" is not connected.`, "invalid_input");
      const bad = nodes.find((n) => ["send_email", "internal_alert"].includes(n.type) && !n.config.emailId);
      if (bad) return errors.noWrite(`Step "${bad.label ?? bad.type}" needs an email.`, "invalid_input");
    }
    const status = { publish: "active", resume: "active", pause: "paused", finish: "finished" }[action]!;
    await getDb().update(schema.journeys).set({ status, updatedAt: nowIso() }).where(eq(schema.journeys.id, id));
    return { id, status };
  },
});
