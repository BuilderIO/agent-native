import { defineAction } from "@agent-native/core";
import { desc } from "drizzle-orm";
import type { BookingLink } from "../shared/api.js";
import { getDb, schema } from "../server/db/index.js";

function rowToBookingLink(
  row: typeof schema.bookingLinks.$inferSelect,
): BookingLink {
  let durations: number[] | undefined;
  if (row.durations) {
    try {
      durations = JSON.parse(row.durations);
    } catch {}
  }
  let customFields: BookingLink["customFields"];
  if (row.customFields) {
    try {
      customFields = JSON.parse(row.customFields);
    } catch {}
  }
  let conferencing: BookingLink["conferencing"];
  if (row.conferencing) {
    try {
      conferencing = JSON.parse(row.conferencing);
    } catch {}
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    duration: row.duration,
    durations,
    customFields,
    conferencing,
    color: row.color ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export default defineAction({
  description: "List all booking links",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const rows = await getDb()
      .select()
      .from(schema.bookingLinks)
      .orderBy(desc(schema.bookingLinks.updatedAt));
    return rows.map(rowToBookingLink);
  },
});
