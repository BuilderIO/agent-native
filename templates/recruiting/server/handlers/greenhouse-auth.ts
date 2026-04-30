import { defineEventHandler, createError } from "h3";
import {
  getSetting,
  putSetting,
  deleteSetting,
} from "@agent-native/core/settings";
import { validateApiKey } from "../lib/greenhouse-api.js";
import { getOrgContext } from "@agent-native/core/org";
import { readBody } from "@agent-native/core/server";

/**
 * SECURITY: scope by org if active, otherwise by the caller's email.
 * Throws if neither is present — never read or write the unprefixed global
 * `greenhouse-api-key` setting, which would leak one solo user's API key
 * to every other solo user on the same database.
 */
function greenhouseSettingsKey(
  orgId: string | null,
  email: string | null,
): string {
  if (orgId) return `o:${orgId}:greenhouse-api-key`;
  if (email) return `u:${email.toLowerCase()}:greenhouse-api-key`;
  throw createError({
    statusCode: 401,
    message: "Sign in to manage Greenhouse credentials.",
  });
}

export const getStatus = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId && !ctx.email) {
    // Not signed in — surface a benign "not connected" so the UI can
    // prompt for sign-in instead of throwing.
    return { connected: false, orgId: null, orgName: null };
  }
  const key = greenhouseSettingsKey(ctx.orgId, ctx.email || null);
  const setting = await getSetting(key);
  const connected =
    !!setting && typeof setting === "object" && "apiKey" in setting;
  // No fall-back to the unprefixed global key — that read is the leak we
  // are fixing. If a solo user previously stored their key under the
  // global key they need to re-enter it via Settings on first access.

  return { connected, orgId: ctx.orgId, orgName: ctx.orgName };
});

export const saveKey = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.email) {
    throw createError({
      statusCode: 401,
      message: "Sign in to manage Greenhouse credentials.",
    });
  }
  // Owner/admin role gating only applies inside an active org. Solo users
  // (no orgId) own their per-user API key.
  if (ctx.orgId && ctx.role !== "owner" && ctx.role !== "admin") {
    throw createError({
      statusCode: 403,
      message: "Only owners and admins can manage the API key",
    });
  }
  const body = await readBody(event);
  const apiKey = body?.apiKey;

  if (!apiKey || typeof apiKey !== "string") {
    throw createError({ statusCode: 400, message: "API key is required" });
  }

  const valid = await validateApiKey(apiKey.trim());
  if (!valid) {
    throw createError({
      statusCode: 401,
      message: "Invalid API key. Please check your Greenhouse credentials.",
    });
  }

  const key = greenhouseSettingsKey(ctx.orgId, ctx.email);
  await putSetting(key, { apiKey: apiKey.trim() });
  return { connected: true };
});

export const deleteKey = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.email) {
    throw createError({
      statusCode: 401,
      message: "Sign in to manage Greenhouse credentials.",
    });
  }
  if (ctx.orgId && ctx.role !== "owner" && ctx.role !== "admin") {
    throw createError({
      statusCode: 403,
      message: "Only owners and admins can manage the API key",
    });
  }
  const key = greenhouseSettingsKey(ctx.orgId, ctx.email);
  await deleteSetting(key);
  return { connected: false };
});
