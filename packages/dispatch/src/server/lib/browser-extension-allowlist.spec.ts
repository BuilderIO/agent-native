import { describe, expect, it } from "vitest";

import {
  isBrowserExtensionIdAllowed,
  resolveAllowedBrowserExtensionIds,
} from "./browser-extension-allowlist.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

describe("browser extension allowlist", () => {
  it("combines exact configured and environment ids", () => {
    expect(
      resolveAllowedBrowserExtensionIds(
        [extensionId, extensionId],
        "ponmlkjihgfedcbaponmlkjihgfedcba",
      ),
    ).toEqual(new Set([extensionId, "ponmlkjihgfedcbaponmlkjihgfedcba"]));
  });

  it("fails loudly for invalid entries instead of producing an empty list", () => {
    expect(() =>
      resolveAllowedBrowserExtensionIds([], "not-an-extension-id"),
    ).toThrow("invalid Chrome extension id");
    expect(() =>
      resolveAllowedBrowserExtensionIds(
        Array.from({ length: 65 }, (_, index) => {
          const suffix = index
            .toString(16)
            .padStart(2, "0")
            .replace(/[0-9a-f]/g, (digit) =>
              "abcdefghijklmnop".charAt("0123456789abcdef".indexOf(digit)),
            );
          return `${"a".repeat(30)}${suffix}`;
        }),
      ),
    ).toThrow("cannot exceed 64");
  });

  it("requires an exact production allowlist match", () => {
    expect(
      isBrowserExtensionIdAllowed({
        extensionId,
        configIds: [extensionId],
        nodeEnv: "production",
        requestOrigin: "https://dispatch.example.com",
      }),
    ).toBe(true);
    expect(
      isBrowserExtensionIdAllowed({
        extensionId,
        configIds: [],
        nodeEnv: "production",
        requestOrigin: "http://localhost:8092",
      }),
    ).toBe(false);
  });

  it("allows unpacked extension ids only from a loopback non-production app", () => {
    expect(
      isBrowserExtensionIdAllowed({
        extensionId,
        configIds: [],
        nodeEnv: "development",
        requestOrigin: "http://localhost:8092",
      }),
    ).toBe(true);
    expect(
      isBrowserExtensionIdAllowed({
        extensionId,
        configIds: [],
        nodeEnv: "development",
        requestOrigin: "https://dispatch.example.com",
      }),
    ).toBe(false);
  });
});
