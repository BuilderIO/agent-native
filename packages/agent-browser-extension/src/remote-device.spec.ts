import { describe, expect, it } from "vitest";

import {
  mergeRemoteDeviceConfig,
  normalizeRelayBaseUrl,
  parseRemoteDevicePairing,
  remoteHostPattern,
} from "./remote-device";

describe("scoped browser relay pairing", () => {
  it("accepts HTTPS and explicit loopback relay URLs only", () => {
    expect(normalizeRelayBaseUrl("https://relay.example/base/")).toBe(
      "https://relay.example/base",
    );
    expect(normalizeRelayBaseUrl("http://localhost:7331")).toBe(
      "http://localhost:7331",
    );
    expect(normalizeRelayBaseUrl("http://relay.example")).toBeNull();
    expect(normalizeRelayBaseUrl("https://user:pass@relay.example")).toBeNull();
    expect(remoteHostPattern("https://relay.example/base")).toBe(
      "https://relay.example/*",
    );
  });

  it("parses a bounded device descriptor and retains an existing matching token", () => {
    const pairing = parseRemoteDevicePairing(
      { id: "device-example" },
      "https://relay.example",
    );
    expect(pairing).not.toBeNull();
    expect(
      mergeRemoteDeviceConfig(
        pairing!,
        "https://dispatch.example",
        {
          deviceId: "device-example",
          token: "example-existing-device-token",
          relayBaseUrl: "https://relay.example",
          dispatchOrigin: "https://dispatch.example",
          updatedAt: "2026-07-29T18:00:00.000Z",
        },
        Date.parse("2026-07-29T19:00:00.000Z"),
      ),
    ).toMatchObject({ token: "example-existing-device-token" });
  });

  it("does not reuse a token across device or relay boundaries", () => {
    const pairing = parseRemoteDevicePairing(
      { id: "different-device" },
      "https://relay.example",
    );
    expect(
      mergeRemoteDeviceConfig(pairing!, "https://dispatch.example", {
        deviceId: "device-example",
        token: "example-existing-device-token",
        relayBaseUrl: "https://relay.example",
        dispatchOrigin: "https://dispatch.example",
        updatedAt: "2026-07-29T18:00:00.000Z",
      }),
    ).toBeNull();
  });
});
