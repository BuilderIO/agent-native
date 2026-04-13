import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody, getSession } from "@agent-native/core/server";
import {
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "@agent-native/core/settings";

async function resolveEmail(event: any): Promise<string | null> {
  const session = await getSession(event);
  return session?.email ?? null;
}

export const getUserPref = defineEventHandler(async (event) => {
  const key = getRouterParam(event, "key");
  if (!key) {
    setResponseStatus(event, 400);
    return { error: "Missing key" };
  }
  const email = await resolveEmail(event);
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "Not authenticated" };
  }
  const data = await getUserSetting(email, key);
  return data ?? {};
});

export const putUserPref = defineEventHandler(async (event) => {
  const key = getRouterParam(event, "key");
  if (!key) {
    setResponseStatus(event, 400);
    return { error: "Missing key" };
  }
  const email = await resolveEmail(event);
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "Not authenticated" };
  }
  const body = await readBody(event);
  await putUserSetting(email, key, body);
  return { success: true };
});

export const deleteUserPref = defineEventHandler(async (event) => {
  const key = getRouterParam(event, "key");
  if (!key) {
    setResponseStatus(event, 400);
    return { error: "Missing key" };
  }
  const email = await resolveEmail(event);
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "Not authenticated" };
  }
  await deleteUserSetting(email, key);
  return { success: true };
});
