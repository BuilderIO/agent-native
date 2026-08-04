/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  automationResponse,
  findAutomation,
  listRuns,
  runResponse,
} from "../server/lib/email-automation.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state for the chat-first app. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const consoleState = await readAppState("automation-console");
    const ownerEmail = getRequestUserEmail();
    const currentView =
      typeof navigation === "object" &&
      navigation !== null &&
      "view" in navigation
        ? navigation.view
        : undefined;
    if (ownerEmail && (currentView === "automations" || consoleState)) {
      const automationId =
        typeof consoleState === "object" &&
        consoleState !== null &&
        "automationId" in consoleState &&
        typeof consoleState.automationId === "string"
          ? consoleState.automationId
          : undefined;
      const automation = await findAutomation(ownerEmail, automationId);
      screen.emailAutomation = {
        automation: automationResponse(automation),
        latestRuns: (await listRuns(ownerEmail)).slice(0, 5).map(runResponse),
      };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
