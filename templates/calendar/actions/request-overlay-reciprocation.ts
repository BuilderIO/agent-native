import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { requestOverlayReciprocation } from "../server/lib/overlay-nudge.js";

export default defineAction({
  description:
    "Emails a person the owner has added to their calendar overlay, asking them to reciprocally add the owner back so their real working hours can be used on booking links. Limited to one request per peer every 24 hours. Throws if the peer isn't in the owner's overlay list.",
  schema: z.object({
    peerEmail: z.string().email(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    return requestOverlayReciprocation({
      ownerEmail,
      peerEmail: args.peerEmail,
    });
  },
});
