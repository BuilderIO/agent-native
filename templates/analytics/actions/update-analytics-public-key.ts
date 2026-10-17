import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { updateAnalyticsPublicKeyOrigins } from "../server/lib/first-party-analytics.js";

const exactHttpsOrigin = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.origin === value &&
    !url.username &&
    !url.password
  );
}, "Use an exact HTTPS origin without a path, query, or fragment.");

export default defineAction({
  description:
    "Append exact HTTPS origins to an Analytics public key's replay allowlist. An empty list allows all; adding the first origin restricts replay, so include every app that records. Updates are limited to keys in your organization or owned by you.",
  schema: z.object({
    id: z.string().min(1).max(200).describe("Public key row id."),
    addReplayAllowedOrigins: z
      .array(exactHttpsOrigin)
      .min(1)
      .max(24)
      .describe(
        "Exact HTTPS origins to append (up to 24); no paths or queries.",
      ),
  }),
  http: { method: "PUT" },
  mcpTool: true,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async ({ id, addReplayAllowedOrigins }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to update Analytics public keys.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const result = await updateAnalyticsPublicKeyOrigins(
      { userEmail, orgId: getRequestOrgId() || null },
      id,
      addReplayAllowedOrigins,
    );
    if (!result) {
      fail("Analytics public key not found or not accessible.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    return result;
  },
});
