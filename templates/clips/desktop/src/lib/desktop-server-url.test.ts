import { describe, expect, it } from "vitest";

import {
  LEGACY_PRODUCTION_SERVER_URL,
  NIGHTLY_DEFAULT_SERVER_URL,
  resolveDesktopServerUrl,
} from "./desktop-server-url";

describe("resolveDesktopServerUrl", () => {
  it("keeps the legacy production origin when a Nightly default changes and its token exists", () => {
    expect(
      resolveDesktopServerUrl({
        storedServerUrl: null,
        defaultServerUrl: NIGHTLY_DEFAULT_SERVER_URL,
        hasLegacyProductionToken: true,
        hasDefaultServerToken: false,
      }),
    ).toBe(LEGACY_PRODUCTION_SERVER_URL);
  });

  it("uses an explicit server URL even when a legacy production token exists", () => {
    expect(
      resolveDesktopServerUrl({
        storedServerUrl: "https://clips-preview.example.test/",
        defaultServerUrl: NIGHTLY_DEFAULT_SERVER_URL,
        hasLegacyProductionToken: true,
        hasDefaultServerToken: false,
      }),
    ).toBe("https://clips-preview.example.test");
  });

  it("uses the Nightly default when no saved URL or legacy token exists", () => {
    expect(
      resolveDesktopServerUrl({
        storedServerUrl: "",
        defaultServerUrl: NIGHTLY_DEFAULT_SERVER_URL,
        hasLegacyProductionToken: false,
        hasDefaultServerToken: false,
      }),
    ).toBe(NIGHTLY_DEFAULT_SERVER_URL);
  });

  it("does not redirect a custom default to production", () => {
    expect(
      resolveDesktopServerUrl({
        storedServerUrl: undefined,
        defaultServerUrl: "https://clips-preview.example.test",
        hasLegacyProductionToken: true,
        hasDefaultServerToken: false,
      }),
    ).toBe("https://clips-preview.example.test");
  });

  it("keeps the Nightly default when both origins have tokens", () => {
    expect(
      resolveDesktopServerUrl({
        storedServerUrl: null,
        defaultServerUrl: NIGHTLY_DEFAULT_SERVER_URL,
        hasLegacyProductionToken: true,
        hasDefaultServerToken: true,
      }),
    ).toBe(NIGHTLY_DEFAULT_SERVER_URL);
  });
});
