import { getRouterParam, readBody, createError } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import { defineOrgHandler } from "../lib/org-context.js";

export const getApplicationHandler = defineOrgHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({
      statusCode: 400,
      message: "Application ID required",
    });
  return gh.getApplication(id);
});

export const advanceApplicationHandler = defineOrgHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({
      statusCode: 400,
      message: "Application ID required",
    });
  const body = await readBody(event);
  await gh.advanceApplication(id, body?.from_stage_id);
  return { success: true };
});

export const moveApplicationHandler = defineOrgHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({
      statusCode: 400,
      message: "Application ID required",
    });
  const body = await readBody(event);
  if (!body?.from_stage_id || !body?.to_stage_id) {
    throw createError({
      statusCode: 400,
      message: "from_stage_id and to_stage_id are required",
    });
  }
  await gh.moveApplication(id, body.from_stage_id, body.to_stage_id);
  return { success: true };
});

export const rejectApplicationHandler = defineOrgHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({
      statusCode: 400,
      message: "Application ID required",
    });
  const body = await readBody(event);
  await gh.rejectApplication(id, body?.rejection_reason_id, body?.notes);
  return { success: true };
});
