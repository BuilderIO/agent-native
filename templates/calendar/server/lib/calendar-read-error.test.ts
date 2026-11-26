import { expect, it } from "vitest";

import { calendarReadFailure } from "./calendar-read-error";

it("classifies unusable stored credentials as requiring authorization", () => {
  expect(
    calendarReadFailure([
      { error: "No usable OAuth tokens for account — please reconnect." },
    ]),
  ).toMatchObject({ errorCode: "calendar_auth_required", statusCode: 409 });
});

it("preserves the authorization requirement alongside a rate limit", () => {
  expect(
    calendarReadFailure([
      { error: "Throttled", code: "RATE_LIMITED" },
      { error: "Invalid grant", code: "AUTH_REQUIRED" },
    ]),
  ).toMatchObject({
    errorCode: "calendar_rate_limited",
    statusCode: 429,
    details: { authRequired: true },
  });
});
