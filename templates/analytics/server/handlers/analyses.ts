import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import {
  deleteScopedSettingRecord,
  getScopedSettingRecord,
  listScopedSettingRecords,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const KEY_PREFIX = "adhoc-analysis-";

export const listAnalyses = defineEventHandler(async (event) => {
  try {
    const scope = await resolveSettingsScope(event);
    const all = await listScopedSettingRecords(scope, KEY_PREFIX);
    const analyses = Object.entries(all).map(([key, data]) => {
      const raw = data as any;
      return {
        id: raw.id ?? key.slice(KEY_PREFIX.length),
        name: raw.name,
        description: raw.description,
        dataSources: raw.dataSources,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        author: raw.author,
      };
    });
    analyses.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return { analyses };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const getAnalysis = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing analysis id" };
  }
  try {
    const key = `${KEY_PREFIX}${id}`;
    const scope = await resolveSettingsScope(event);
    const data = await getScopedSettingRecord(scope, key);
    if (!data) {
      setResponseStatus(event, 404);
      return { error: "Analysis not found" };
    }
    return { id, ...data };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const deleteAnalysis = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing analysis id" };
  }
  const scope = await resolveSettingsScope(event);
  const key = `${KEY_PREFIX}${id}`;
  await deleteScopedSettingRecord(scope, key);
  return { id, success: true };
});
