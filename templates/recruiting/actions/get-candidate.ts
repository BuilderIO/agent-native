import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withCredentialContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function getCandidate(args: { id?: number }) {
  if (!args.id) throw new Error("--id is required");
  return gh.getCandidate(args.id);
}

export default defineAction({
  description: "Get full details about a specific candidate",
  schema: z.object({
    id: z.coerce.number().optional().describe("Candidate ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() ?? null;
    const email = getRequestUserEmail() ?? null;
    return withCredentialContext({ email, orgId }, () => getCandidate(args));
  },
});
