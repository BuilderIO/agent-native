import { beforeEach, describe, expect, it, vi } from "vitest";

const readConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock("./factory-workflow-connections.js", () => ({
  readProviderConnections: readConnectionsMock,
}));

import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import type { TripwireSink } from "../tripwire/types.js";
import { reportConnectionStatusMismatch } from "./connection-status-tripwire.js";

const SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";
const identity = { userEmail: "owner@example.com", orgId: "org-1" };
// The same call with a sink that drops every event: the baseline an observed call must match.
const discard: TripwireSink = () => undefined;

function report(tripwire: TripwireSink) {
  return reportConnectionStatusMismatch({
    tripwire,
    provider: "hubspot",
    operationId: "hubspot.ownerById",
    identity,
  });
}

beforeEach(() => {
  readConnectionsMock.mockReset();
});

describe("connection_status_mismatch tripwire", () => {
  it("records a mismatch when the status check says connected and the run found no credential", async () => {
    readConnectionsMock.mockResolvedValue([
      {
        provider: "hubspot",
        status: "connected",
        connectWith: "workspace-connection",
        detail: `Connected with ${SECRET}`,
      },
    ]);
    const { sink, events } = createCapturingTripwireSink();

    await expect(report(sink)).resolves.toBeUndefined();
    await expect(report(discard)).resolves.toBeUndefined();

    expect(readConnectionsMock).toHaveBeenCalledWith(["hubspot"], identity);
    const stored = {
      ...events[0],
      details: sanitizeDetails(events[0].details).fields,
    };
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(JSON.stringify(stored)).not.toContain(identity.userEmail);
  });

  it("logs and resolves when the status check itself fails, and never throws", async () => {
    readConnectionsMock.mockRejectedValue(
      new Error(`Vault unreachable ${SECRET}`),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { sink } = createCapturingTripwireSink();

    await expect(report(sink)).resolves.toBeUndefined();
    await expect(report(discard)).resolves.toBeUndefined();

    const logged = consoleError.mock.calls.map((call) => String(call[0]));
    expect(logged.join("\n")).not.toContain(SECRET);
    consoleError.mockRestore();
  });
});
