import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { searchPeopleForUser } from "../server/lib/people-search.js";

export default defineAction({
  description:
    "Search Google contacts and the Google Workspace directory for people by name or email",
  schema: z.object({
    q: z.string().optional().describe("Search query (name or email)"),
    scope: z
      .enum(["all", "directory"])
      .optional()
      .describe(
        "Search scope. Use 'all' for Google contacts plus Workspace directory, or 'directory' for same-company directory results only.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    return searchPeopleForUser(email, {
      q: args.q,
      scope: args.scope,
    });
  },
});
