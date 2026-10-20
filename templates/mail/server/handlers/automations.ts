import { getSession } from "@agent-native/core/server";
import { defineEventHandler, createError } from "h3";

import { triggerAutomationsDebounced } from "../lib/automation-engine.js";

export const triggerAutomations = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  return triggerAutomationsDebounced(session.email);
});
