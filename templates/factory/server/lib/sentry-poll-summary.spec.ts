import { describe, expect, it } from "vitest";

import { sentryPollObservationSummary } from "./sentry-poll-summary.js";

describe("sentryPollObservationSummary", () => {
  it("reserves the empty message for polls that saw no issues", () => {
    expect(sentryPollObservationSummary(0, 0)).toBe(
      "No unresolved Sentry errors were observed.",
    );
  });

  it("distinguishes existing observed issues from new inbox additions", () => {
    expect(sentryPollObservationSummary(2, 0)).toBe(
      "Observed 2 unresolved Sentry errors; none were new.",
    );
    expect(sentryPollObservationSummary(1, 1)).toBe(
      "Added 1 new Sentry error.",
    );
  });
});
