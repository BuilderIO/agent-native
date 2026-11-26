import { describe, expect, it } from "vitest";

import connectGoogleCalendar from "./connect-google-calendar.js";

describe("actions that need a signed-in browser", () => {
  it("connect-google-calendar refuses full-app panels", () => {
    // It starts an OAuth flow for the owner's calendar account.
    expect(connectGoogleCalendar.requiresSignedInBrowser).toBe(true);
  });
});
