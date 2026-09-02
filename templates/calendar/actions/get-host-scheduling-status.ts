import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getHostSchedulingStatus } from "../server/lib/booking-host-availability.js";

export default defineAction({
  description:
    "For a booking link's required hosts, report whether each host's working hours will actually be enforced: 'active' (two-way calendar overlay plus a saved availability schedule), 'awaiting-reciprocal-overlay' (the owner added the host but the host hasn't added the owner back), 'missing-schedule' (overlay is reciprocal but the host never saved working hours), or 'not-overlaid' (host isn't in the owner's calendar overlay at all, so only free/busy is checked).",
  schema: z.object({
    hostEmails: z.array(z.string()).max(50),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    return getHostSchedulingStatus(ownerEmail, args.hostEmails);
  },
});
