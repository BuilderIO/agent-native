import { describe, expect, it } from "vitest";

import { isBrainSourceDue, nextBrainSourceSyncAt } from "./sync-sources.js";

const FAILED_AT = "2026-07-29T16:00:00.000Z";
const POLL_INTERVAL_MS = 60 * 60 * 1000;

function source(
  overrides: Record<string, unknown> = {},
): Parameters<typeof isBrainSourceDue>[0] {
  return {
    id: "source-1",
    title: "Brain source",
    provider: "granola",
    status: "active",
    sourceKey: null,
    ingestTokenHash: null,
    configJson: JSON.stringify({ autoSync: true, pollMinutes: 60 }),
    cursorJson: "{}",
    lastSyncedAt: null,
    lastError: null,
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    visibility: "org",
    createdAt: FAILED_AT,
    updatedAt: FAILED_AT,
    ...overrides,
  } as Parameters<typeof isBrainSourceDue>[0];
}

describe("Brain source sync scheduling", () => {
  it("does not immediately retry an errored auto-sync source", () => {
    const failedSource = source({
      status: "error",
      lastError: "Temporary provider failure",
    });
    const failedAt = Date.parse(FAILED_AT);

    expect(isBrainSourceDue(failedSource, failedAt)).toBe(false);
    expect(
      isBrainSourceDue(failedSource, failedAt + POLL_INTERVAL_MS - 1),
    ).toBe(false);
    expect(nextBrainSourceSyncAt(failedSource)).toBe(
      "2026-07-29T17:00:00.000Z",
    );
  });

  it("makes an errored auto-sync source due after its poll interval", () => {
    const failedSource = source({
      status: "error",
      lastError: "Temporary provider failure",
    });

    expect(
      isBrainSourceDue(failedSource, Date.parse(FAILED_AT) + POLL_INTERVAL_MS),
    ).toBe(true);
  });

  it("keeps paused and non-polling sources out of automatic retries", () => {
    const now = Date.parse(FAILED_AT) + POLL_INTERVAL_MS;

    expect(isBrainSourceDue(source({ status: "paused" }), now)).toBe(false);
    expect(
      isBrainSourceDue(source({ status: "error", provider: "manual" }), now),
    ).toBe(false);
  });
});
