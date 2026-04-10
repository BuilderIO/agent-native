import { defineEventHandler, getRouterParam, createError } from "h3";
import { getOrgContext } from "@agent-native/core/org";
import * as gh from "../lib/greenhouse-api.js";
import { withOrgContext } from "../lib/greenhouse-api.js";

export const getJobStagesHandler = defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id) throw createError({ statusCode: 400, message: "Job ID required" });
  const ctx = await getOrgContext(event);
  const run = () => gh.getJobStages(id);
  return ctx.orgId ? withOrgContext(ctx.orgId, run) : run();
});
