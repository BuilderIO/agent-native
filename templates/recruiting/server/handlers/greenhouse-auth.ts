import { defineEventHandler, readBody, createError } from "h3";
import {
  getSetting,
  putSetting,
  deleteSetting,
} from "@agent-native/core/settings";
import { validateApiKey } from "../lib/greenhouse-api.js";

export const getStatus = defineEventHandler(async () => {
  const setting = await getSetting("greenhouse-api-key");
  const connected =
    !!setting && typeof setting === "object" && "apiKey" in setting;
  return { connected };
});

export const saveKey = defineEventHandler(async (event) => {
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

  await putSetting("greenhouse-api-key", { apiKey: apiKey.trim() });
  return { connected: true };
});

export const deleteKey = defineEventHandler(async () => {
  await deleteSetting("greenhouse-api-key");
  return { connected: false };
});
