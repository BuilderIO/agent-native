import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  getSetting,
  putSetting,
  deleteSetting,
  getAllSettings,
} from "@agent-native/core/settings";

const KEY_PREFIX = "config-";

export const listExplorerConfigs = defineEventHandler(async (_event) => {
  try {
    const all = await getAllSettings();
    const configs = Object.entries(all)
      .filter(([key]) => key.startsWith(KEY_PREFIX))
      .map(([key, data]) => ({
        id: key.slice(KEY_PREFIX.length),
        name:
          (data as Record<string, unknown>).name ??
          key.slice(KEY_PREFIX.length),
        ...data,
      }));
    return { configs };
  } catch (err: any) {
    setResponseStatus(_event, 500);
    return { error: err.message };
  }
});

export const getExplorerConfig = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  try {
    const data = await getSetting(`${KEY_PREFIX}${id}`);
    if (!data) {
      setResponseStatus(event, 404);
      return { error: "Config not found" };
    }
    return { id, ...data };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const saveExplorerConfig = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  try {
    const body = await readBody(event);
    await putSetting(`${KEY_PREFIX}${id}`, body);
    return { id, success: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const deleteExplorerConfig = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  await deleteSetting(`${KEY_PREFIX}${id}`);
  return { id, success: true };
});
