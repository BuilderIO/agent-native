import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listBookings } from "../server/bookings-repo.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "Export bookings to a CSV string",
  schema: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    status: z.string().optional(),
  }),
  run: async (args) => {
    const bookings = await listBookings({
      hostEmail: currentUserEmail(),
      from: args.from,
      to: args.to,
      status: args.status as any,
    });
    const header = [
      "uid",
      "title",
      "startTime",
      "endTime",
      "status",
      "attendeeName",
      "attendeeEmail",
      "location",
    ];
    const lines = [header.join(",")];
    for (const b of bookings) {
      const a = b.attendees[0];
      lines.push(
        [
          b.uid,
          csvEscape(b.title),
          b.startTime,
          b.endTime,
          b.status,
          csvEscape(a?.name ?? ""),
          csvEscape(a?.email ?? ""),
          csvEscape(b.location?.kind ?? ""),
        ].join(","),
      );
    }
    return { csv: lines.join("\n"), count: bookings.length };
  },
});

function csvEscape(s: string): string {
  if (s == null) return "";
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
