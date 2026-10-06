import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { OverlayPerson } from "../shared/api.js";

export default defineAction({
  description:
    "Remove a person from the caller's calendar overlay list (subscribed peers).",
  schema: z.object({
    email: z.string().email(),
  }),
  http: { method: "PUT" },
  run: async (args): Promise<OverlayPerson[]> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const normalizedEmail = args.email.trim().toLowerCase();
    const result = await mutateUserSetting(
      email,
      "calendar-overlay-people",
      (current) => {
        const people =
          (current as { people?: OverlayPerson[] } | null)?.people ?? [];
        return {
          people: people.filter(
            (p) => p.email.trim().toLowerCase() !== normalizedEmail,
          ),
        };
      },
    );
    return (result as { people: OverlayPerson[] }).people;
  },
});
