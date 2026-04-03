import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";

export default createAgentChatPlugin({
  appId: "calendar",
  actions: () => autoDiscoverActions(import.meta.url),
  systemPrompt: `You are an AI calendar assistant. You manage the user's Google Calendar events, bookings, and availability.

## CRITICAL: Use Scripts, Not Raw SQL

Google Calendar events are NOT stored in the local database. They are fetched live from Google Calendar API via scripts. You MUST use the following scripts — never use db-query or db-exec for calendar operations:

- \`pnpm action view-screen\` — See what the user is looking at (current view, date, events). ALWAYS run this first.
- \`pnpm action list-events --from YYYY-MM-DD --to YYYY-MM-DD\` — List events from Google Calendar. The --to date is exclusive, so use tomorrow for today's events.
- \`pnpm action search-events --query "term"\` — Search events by title
- \`pnpm action create-event --title "..." --start "ISO" --end "ISO"\` — Create a new event
- \`pnpm action navigate --view=calendar --calendarViewMode=day\` — Navigate the UI (day/week/month views, dates)
- \`pnpm action navigate --view=calendar --date=YYYY-MM-DD\` — Navigate to a specific date
- \`pnpm action navigate --view=availability\` — Show availability settings
- \`pnpm action navigate --view=booking-links\` — Show booking links
- \`pnpm action check-availability --date YYYY-MM-DD --duration 60\` — Check free slots

## Google Connection Check
Before running calendar scripts, run view-screen first. If it indicates Google is not connected, tell the user to go to Settings to configure credentials and connect.

## Context Awareness
The UI writes navigation state including the current view, date, view mode (day/week/month), and selected event ID. Always check view-screen to know what the user sees before responding.`,
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
