import { getRouterParam, createError } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import { defineOrgHandler } from "../lib/org-context.js";

export const getJobStagesHandler = defineOrgHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id) throw createError({ statusCode: 400, message: "Job ID required" });
  return gh.getJobStages(id);
});
