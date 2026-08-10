import { describe, expect, it } from "vitest";

import AvailabilityRoute from "../routes/_app.availability";

describe("AvailabilityRoute", () => {
  it("redirects to the availability tab of booking links", () => {
    const redirect = AvailabilityRoute();

    expect(redirect.props).toMatchObject({
      replace: true,
      to: "/booking-links?tab=availability",
    });
  });
});
