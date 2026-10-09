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
    "Add exact HTTPS origins to a first-party Analytics public key's replay allowlist. If no origins are listed, any origin is currently allowed; adding the first origin restricts replay to the allowlist, so include every app that needs replay. Returns the key id and prefix, updated allowlist, newly added origins, and whether it changed. Existing origins and key settings are preserved; the key must belong to the active organization or current user.",
  schema: z.object({
    id: z.string().min(1).max(200).describe("Public key row id to update."),
    addReplayAllowedOrigins: z
      .array(exactHttpsOrigin)
      .min(1)
      .max(24)
      .describe(
        "Exact HTTPS origins to append, up to 24 per call. When the key has no origins, it accepts any origin; adding the first restricts replay to the listed origins, so include every app that needs replay. Use origins such as https://app.example.com, with no path, query, or fragment.",
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
