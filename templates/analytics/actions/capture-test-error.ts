import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { captureTestError } from "../server/lib/error-capture.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Generate a sample captured error to verify the Error capture pipeline end-to-end. Creates or reopens an error issue owned by the current user/org so it shows up in the Monitoring → Errors view.",
  schema: z.object({
    message: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe("Optional custom error message for the sample error."),
    type: z
      .string()
      .trim()
      .regex(/^[A-Za-z_$][\w$.]{0,79}$/)
      .optional()
      .describe("Optional error type/name, e.g. TypeError. Defaults to Error."),
  }),
  http: { method: "POST" },
  run: async (args) => {
    return captureTestError(resolveScope(), args);
  },
});
