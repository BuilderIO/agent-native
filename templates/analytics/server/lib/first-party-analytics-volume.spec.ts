import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT,
  DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS,
  FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT_ENV,
  FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS_ENV,
  FirstPartyPostgresEventVolumeLimitError,
  firstPartyPostgresEventVolumeWindowStart,
  getFirstPartyPostgresEventVolumeConfig,
} from "./first-party-analytics-volume";

describe("first-party Postgres event volume guard", () => {
  it("uses a bounded default policy", () => {
    expect(getFirstPartyPostgresEventVolumeConfig({})).toEqual({
      eventLimit: DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT,
      windowDays: DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS,
    });
  });

  it("accepts explicit operator overrides", () => {
    expect(
      getFirstPartyPostgresEventVolumeConfig({
        [FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT_ENV]: "250000",
        [FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS_ENV]: "45",
      }),
    ).toEqual({ eventLimit: 250000, windowDays: 45 });
  });

  it("rejects invalid operator configuration instead of silently coercing it", () => {
    expect(() =>
      getFirstPartyPostgresEventVolumeConfig({
        [FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT_ENV]: "unlimited",
      }),
    ).toThrow("must be an integer");
  });

  it("uses deterministic UTC window boundaries", () => {
    expect(
      firstPartyPostgresEventVolumeWindowStart("2026-08-09T19:00:00.000Z", 30),
    ).toBe("2026-08-05T00:00:00.000Z");
  });

  it("exposes an HTTP 429 error with the reservation proof", () => {
    const error = new FirstPartyPostgresEventVolumeLimitError(
      {
        tenantKey: "org:org-1",
        windowStart: "2026-07-26T00:00:00.000Z",
        eventCount: 1_000_000,
        eventLimit: 1_000_000,
      },
      12,
    );
    expect(error.statusCode).toBe(429);
    expect(error.message).toContain("1000000/1000000");
    expect(error.message).toContain("connect your own analytics database");
  });
});
