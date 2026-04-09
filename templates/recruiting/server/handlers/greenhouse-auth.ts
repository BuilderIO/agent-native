import { defineEventHandler, createError } from "h3";
import {
  getSetting,
  putSetting,
  deleteSetting,
} from "@agent-native/core/settings";
import { validateApiKey } from "../lib/greenhouse-api.js";
import { getOrgContext } from "../lib/org-context.js";
import { readBody } from "@agent-native/core/server";

function greenhouseSettingsKey(orgId: string | null): string {
  return orgId ? `org:${orgId}:greenhouse-api-key` : "greenhouse-api-key";
}

export const getStatus = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  const key = greenhouseSettingsKey(ctx.orgId);
  const setting = await getSetting(key);
  let connected =
    !!setting && typeof setting === "object" && "apiKey" in setting;

  // Fall back to global key for backwards compat
  if (!connected && ctx.orgId) {
    const global = await getSetting("greenhouse-api-key");
    connected = !!global && typeof global === "object" && "apiKey" in global;
  }

  return { connected, orgId: ctx.orgId, orgName: ctx.orgName };
});

export const saveKey = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (ctx.role !== "owner" && ctx.role !== "admin") {
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

  const key = greenhouseSettingsKey(ctx.orgId);
  await putSetting(key, { apiKey: apiKey.trim() });
  return { connected: true };
});

export const deleteKey = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw createError({
      statusCode: 403,
      message: "Only owners and admins can manage the API key",
    });
  }
  const key = greenhouseSettingsKey(ctx.orgId);
  await deleteSetting(key);
  return { connected: false };
});
