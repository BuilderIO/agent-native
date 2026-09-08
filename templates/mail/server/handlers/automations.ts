import { getSession } from "@agent-native/core/server";
import { defineEventHandler, createError } from "h3";

import { triggerAutomationsDebounced } from "../lib/automation-engine.js";

// Automation rule CRUD lives on the action surface (`list-automations`,
// `create-automation`, `update-automation`, `delete-automation`) backed by
// ../lib/automations.js. Only the trigger endpoint remains a route.

export const triggerAutomations = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  return triggerAutomationsDebounced(session.email);
});
