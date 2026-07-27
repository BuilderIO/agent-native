import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { loadContactsForEmail } from "../server/handlers/emails.js";
import { resolveOwnerEmail } from "./helpers.js";

export default defineAction({
  description:
    "Look up an email address by name or partial email from the user's Google Contacts and recent message history. Use this BEFORE asking the user for someone's address — guessing patterns like 'firstinitiallastname@company.com' is unreliable, and most recipients are already in the user's contacts. Returns up to N matches sorted by how often the user emails them.",
  schema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Name, partial name, or partial email to search for (e.g., 'Jacqueline', 'jacqueline lamb', 'jlamb', 'lamb@'). Case-insensitive substring match against name and email.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .default(5)
      .describe("Maximum matches to return. Default 5."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ query, limit }) => {
    const ownerEmail = await resolveOwnerEmail();
    const contacts = await loadContactsForEmail(ownerEmail);

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const matches = contacts
      .filter((c) => {
        const haystack = `${c.name} ${c.email}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      })
      .slice(0, limit)
      .map(({ name, email, count }) => ({ name, email, count }));

    return { matches, total: matches.length };
  },
});
