/**
 * Serve `/booking/:uid.ics` — iCalendar download for a booking.
 */
import { defineEventHandler, getRouterParam, setResponseHeader } from "h3";
import { getBookingByUid, buildIcs } from "@agent-native/scheduling/server";

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, "uid");
  if (!uid) throw new Error("Missing uid");
  const booking = await getBookingByUid(uid);
  if (!booking) throw new Error("Booking not found");
  setResponseHeader(event, "content-type", "text/calendar; charset=utf-8");
  setResponseHeader(
    event,
    "content-disposition",
    `attachment; filename="${booking.uid}.ics"`,
  );
  return buildIcs(booking, booking.hostEmail);
});
