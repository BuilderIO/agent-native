import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createRequest } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Request access to a credential for an app. Non-admins use this to ask workspace admins to provision a secret.",
  schema: z.object({
    credentialKey: z
      .string()
      .describe("Environment variable name needed, e.g. GOOGLE_CLIENT_ID"),
    appId: z.string().describe("App ID that needs the credential"),
    reason: z.string().optional().describe("Why this credential is needed"),
  }),
  run: async (args) => createRequest(args),
});
