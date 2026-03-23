import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import * as googleCalendar from "../lib/google-calendar.js";

export const syncGoogleCalendar = defineEventHandler(async (event: H3Event) => {
  try {
    if (!googleCalendar.isConnected()) {
      setResponseStatus(event, 400);
      return { error: "Google Calendar not connected" };
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const defaultTo = new Date(now);
    defaultTo.setDate(defaultTo.getDate() + 90);

    const body = await readBody(event);
    const from = (body?.from as string) || defaultFrom.toISOString();
    const to = (body?.to as string) || defaultTo.toISOString();

    // Events are now read directly from Google Calendar API — no local sync needed.
    // This endpoint just verifies the connection and returns a count.
    const { events: googleEvents, errors } = await googleCalendar.listEvents(
      from,
      to,
    );

    return {
      synced: 0,
      total: googleEvents.length,
      message:
        "Events are now read directly from Google Calendar. No local sync needed.",
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
