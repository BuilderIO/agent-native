import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { OverlayPerson } from "../shared/api.js";
import { getNextOverlayColor } from "../shared/overlay-colors.js";

export default defineAction({
  description:
    "Add a person to the caller's calendar overlay list (subscribed peers), assigning the next available color. No-op if the person is already on the list.",
  schema: z.object({
    email: z.string().email(),
    name: z.string().optional(),
  }),
  http: { method: "PUT" },
  run: async (args): Promise<OverlayPerson[]> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    // Read-modify-write happens inside mutateUserSetting's compare-and-swap
    // retry loop, not on a snapshot the client fetched earlier: two adds
    // (separate tabs, or the search dialog and the request-email landing
    // page) starting from the same stale list would otherwise let the
    // later PUT silently overwrite the earlier one's addition.
    const normalizedEmail = args.email.trim().toLowerCase();
    const result = await mutateUserSetting(
      email,
      "calendar-overlay-people",
      (current) => {
        const people =
          (current as { people?: OverlayPerson[] } | null)?.people ?? [];
        if (
          people.some((p) => p.email.trim().toLowerCase() === normalizedEmail)
        ) {
          return { people };
        }
        const color = getNextOverlayColor(people);
        return {
          people: [...people, { email: args.email, name: args.name, color }],
        };
      },
    );
    return (result as { people: OverlayPerson[] }).people;
  },
});
