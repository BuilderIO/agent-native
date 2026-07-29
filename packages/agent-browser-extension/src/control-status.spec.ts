import { describe, expect, it } from "vitest";

import {
  BROWSER_CONTROL_STATUS_MAX_AGE_MS,
  parseBrowserControlStatus,
} from "./control-status";

describe("browser control status", () => {
  it("preserves explicit available and unavailable states", () => {
    const now = Date.parse("2026-07-29T18:00:30.000Z");
    expect(
      parseBrowserControlStatus(
        {
          state: "available",
          nativeHostConnected: true,
          relayConnected: true,
          controlTransport: "native",
          activeTasks: 2,
          updatedAt: "2026-07-29T18:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({ state: "available", activeTasks: 2 });
    expect(
      parseBrowserControlStatus(
        {
          state: "unavailable",
          nativeHostConnected: false,
          relayConnected: false,
          controlTransport: null,
          activeTasks: 0,
          reason: "connection-not-configured",
          updatedAt: "2026-07-29T18:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({ state: "unavailable" });
    expect(parseBrowserControlStatus({ state: "available" }, now)).toBeNull();
  });

  it("does not present a stale native-host heartbeat as connected", () => {
    const updatedAt = Date.parse("2026-07-29T18:00:00.000Z");
    expect(
      parseBrowserControlStatus(
        {
          state: "available",
          nativeHostConnected: true,
          relayConnected: false,
          controlTransport: "native",
          activeTasks: 0,
          updatedAt: new Date(updatedAt).toISOString(),
        },
        updatedAt + BROWSER_CONTROL_STATUS_MAX_AGE_MS + 1,
      ),
    ).toBeNull();
  });

  it("reports the relay as control owner only while native messaging is absent", () => {
    const now = Date.parse("2026-07-29T18:00:30.000Z");
    expect(
      parseBrowserControlStatus(
        {
          state: "available",
          nativeHostConnected: false,
          relayConnected: true,
          controlTransport: "relay",
          activeTasks: 0,
          updatedAt: "2026-07-29T18:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({ controlTransport: "relay" });
    expect(
      parseBrowserControlStatus(
        {
          state: "available",
          nativeHostConnected: true,
          relayConnected: true,
          controlTransport: "relay",
          activeTasks: 0,
          updatedAt: "2026-07-29T18:00:00.000Z",
        },
        now,
      ),
    ).toBeNull();
  });
});
