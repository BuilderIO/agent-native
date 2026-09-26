import { defineAction } from "@agent-native/core/action";
import { getAppProductionUrl } from "@agent-native/core/server";
import { z } from "zod";

import { cancelBookingById } from "../server/handlers/bookings.js";
import { requireActionUserEmail } from "./event-action-helpers.js";

export default defineAction({
  description:
    "Cancel a booking and its linked calendar and Zoom meetings. Use this instead of delete-event or delete-events for booking-backed events. If Zoom needs review, first confirm the meeting was canceled or no meeting exists.",
  schema: z.object({
    id: z.string().min(1).describe("Booking id"),
    zoomMeetingResolved: z
      .boolean()
      .optional()
      .describe("Confirm the Zoom meeting was checked and resolved"),
  }),
  toolCallable: false,
  needsApproval: true,
  run: async ({ id, zoomMeetingResolved }) => {
    requireActionUserEmail();
    return cancelBookingById(id, getAppProductionUrl(), {
      zoomMeetingResolved,
    });
  },
});
