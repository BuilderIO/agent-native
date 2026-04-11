/**
 * Shared action: look up an employee in the company directory.
 *
 * Every app in the workspace inherits this action automatically — no
 * wiring required. From the agent's perspective it behaves exactly like
 * a template action: the tool shows up in every app's agent, and calling
 * it from the UI via `useActionQuery("company-directory", { ... })` Just
 * Works.
 *
 * Replace the stub implementation with a real call to your company
 * directory (SCIM, Okta Users API, internal /people endpoint, etc.).
 */
import { z } from "zod";
import { defineAction } from "@agent-native/core";

export default defineAction({
  description:
    "Look up a person in the {{APP_TITLE}} company directory by name or email. Returns role, team, and manager.",
  schema: z.object({
    query: z.string().describe("Name, email, or partial match to search for"),
  }),
  run: async (args) => {
    // TODO: replace with a real lookup. This stub just echoes the query
    // so the agent has a reasonable no-op while you wire up the real
    // directory integration.
    return {
      results: [
        {
          query: args.query,
          name: "(stub) " + args.query,
          role: "Unknown",
          team: "Unknown",
          manager: null,
        },
      ],
    };
  },
});
