import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  appId: "calendar",
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { bookings, bookingLinks } = await import("../db/schema.js");
    const { like, desc } = await import("drizzle-orm");
    return {
      bookings: {
        label: "Bookings",
        icon: "email",
        search: async (query: string) => {
          const db = getDb();
          const rows = query
            ? await db
                .select()
                .from(bookings)
                .where(like(bookings.name, `%${query}%`))
                .limit(15)
            : await db
                .select()
                .from(bookings)
                .orderBy(desc(bookings.start))
                .limit(15);
          return rows.map((booking) => ({
            id: booking.id,
            label: `${booking.eventTitle || "Booking"} — ${booking.name}`,
            description: booking.start,
            icon: "document" as const,
            refType: "booking",
            refId: booking.id,
          }));
        },
      },
      "booking-links": {
        label: "Booking Links",
        icon: "document",
        search: async (query: string) => {
          const db = getDb();
          const rows = query
            ? await db
                .select()
                .from(bookingLinks)
                .where(like(bookingLinks.title, `%${query}%`))
                .limit(15)
            : await db
                .select()
                .from(bookingLinks)
                .orderBy(desc(bookingLinks.updatedAt))
                .limit(15);
          return rows.map((link) => ({
            id: link.id,
            label: link.title,
            description: `${link.duration}min · /${link.slug}`,
            icon: "document" as const,
            refType: "booking-link",
            refId: link.id,
          }));
        },
      },
    };
  },
});
