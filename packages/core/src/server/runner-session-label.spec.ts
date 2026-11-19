import { describe, expect, it } from "vitest";

import {
  RUNNER_SESSION_LABEL,
  keepRunnerSessionExpiry,
} from "./runner-session-label.js";

const minted = new Date("2030-01-01T02:00:00.000Z");
const extended = new Date("2030-01-31T00:00:00.000Z");

function endpointWith(session: { userAgent?: unknown; expiresAt?: unknown }) {
  return { context: { session: { session } } };
}

describe("keepRunnerSessionExpiry", () => {
  it("labels runner sessions as runner", () => {
    expect(RUNNER_SESSION_LABEL).toBe("runner");
  });

  it("keeps a runner session's minted expiry when an update extends it", () => {
    expect(
      keepRunnerSessionExpiry(
        { expiresAt: extended },
        endpointWith({ userAgent: "runner", expiresAt: minted }),
      ),
    ).toEqual({ data: { expiresAt: minted } });
  });

  it("reads a serialized expiry", () => {
    expect(
      keepRunnerSessionExpiry(
        { expiresAt: extended },
        endpointWith({ userAgent: "runner", expiresAt: minted.toISOString() }),
      ),
    ).toEqual({ data: { expiresAt: minted } });
  });

  it("leaves other sessions alone", () => {
    expect(
      keepRunnerSessionExpiry(
        { expiresAt: extended },
        endpointWith({ userAgent: "Mozilla/5.0", expiresAt: minted }),
      ),
    ).toBeUndefined();
    expect(
      keepRunnerSessionExpiry({ expiresAt: extended }, null),
    ).toBeUndefined();
    expect(
      keepRunnerSessionExpiry({ expiresAt: extended }, { context: null }),
    ).toBeUndefined();
  });

  it("leaves updates that do not touch the expiry alone", () => {
    expect(
      keepRunnerSessionExpiry(
        {},
        endpointWith({ userAgent: "runner", expiresAt: minted }),
      ),
    ).toBeUndefined();
  });

  it("refuses a runner session whose expiry cannot be read", () => {
    expect(() =>
      keepRunnerSessionExpiry(
        { expiresAt: extended },
        endpointWith({ userAgent: "runner", expiresAt: "not a date" }),
      ),
    ).toThrow("Runner session has no readable expiry.");
  });
});
