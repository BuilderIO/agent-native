import { defineEventHandler, getRouterParam, createError } from "h3";
import { getOrgContext } from "@agent-native/core/org";
import * as gh from "../lib/greenhouse-api.js";
import { withCredentialContext } from "../lib/greenhouse-api.js";

export const getJobStagesHandler = defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id) throw createError({ statusCode: 400, message: "Job ID required" });
  const ctx = await getOrgContext(event);
  if (!ctx.orgId && !ctx.email) {
    throw createError({
      statusCode: 401,
      message: "Sign in to view job stages.",
    });
  }
  return withCredentialContext(
    { email: ctx.email || null, orgId: ctx.orgId },
    () => gh.getJobStages(id),
  );
});
