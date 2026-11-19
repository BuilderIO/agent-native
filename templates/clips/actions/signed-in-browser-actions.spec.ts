import { describe, expect, it } from "vitest";

import connectCalendar from "./connect-calendar.js";
import connectSlack from "./connect-slack.js";
import disconnectCalendar from "./disconnect-calendar.js";
import disconnectSlack from "./disconnect-slack.js";

// Connecting starts an OAuth flow and disconnecting revokes stored tokens,
// so a full-app panel hands both to a signed-in browser.
const actions = [
  ["connect-calendar", connectCalendar],
  ["connect-slack", connectSlack],
  ["disconnect-calendar", disconnectCalendar],
  ["disconnect-slack", disconnectSlack],
] as const;

describe("actions that need a signed-in browser", () => {
  it.each(actions)("%s refuses full-app panels", (_name, action) => {
    expect(action.requiresSignedInBrowser).toBe(true);
  });
});
