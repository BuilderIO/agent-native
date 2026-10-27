import {
  defineEventHandler,
  getRouterParam,
  getHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { readBody } from "../server/h3-helpers.js";
import { getSetting, putSetting, deleteSetting } from "./store.js";

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "");
}

export const getSettingHandler = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const value = await getSetting(key);
  if (!value) {
    setResponseStatus(event, 404);
    return { error: `No setting for ${key}` };
  }
  return value;
});

export const putSettingHandler = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const body = await readBody(event);
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await putSetting(key, body, { requestSource });
  return body;
});

export const deleteSettingHandler = defineEventHandler(
  async (event: H3Event) => {
    const key = safeKey(String(getRouterParam(event, "key")));
    const requestSource = getHeader(event, "x-request-source") || undefined;
    await deleteSetting(key, { requestSource });
    return { ok: true };
  },
);
