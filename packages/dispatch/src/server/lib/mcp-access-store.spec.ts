import { describe, expect, it } from "vitest";

import {
  isAppAllowedByMcpAccess,
  normalizeMcpAppAccessSettings,
} from "./mcp-access-store.js";

describe("normalizeMcpAppAccessSettings", () => {
  it("defaults to all apps", () => {
    expect(normalizeMcpAppAccessSettings(null)).toEqual({
      mode: "all-apps",
      selectedAppIds: [],
      updatedAt: undefined,
      updatedBy: undefined,
    });
  });

  it("normalizes selected app ids", () => {
    expect(
      normalizeMcpAppAccessSettings({
        mode: "selected-apps",
        selectedAppIds: [" Mail ", "mail", "calendar"],
        updatedAt: "2026-05-20T12:00:00.000Z",
        updatedBy: "admin@example.test",
      }),
    ).toEqual({
      mode: "selected-apps",
      selectedAppIds: ["mail", "calendar"],
      updatedAt: "2026-05-20T12:00:00.000Z",
      updatedBy: "admin@example.test",
    });
  });
});

describe("isAppAllowedByMcpAccess", () => {
  it("allows every app in all-apps mode", () => {
    expect(
      isAppAllowedByMcpAccess("mail", {
        mode: "all-apps",
        selectedAppIds: [],
      }),
    ).toBe(true);
  });

  it("checks selected grants in selected-apps mode", () => {
    expect(
      isAppAllowedByMcpAccess("mail", {
        mode: "selected-apps",
        selectedAppIds: ["calendar"],
      }),
    ).toBe(false);
    expect(
      isAppAllowedByMcpAccess("calendar", {
        mode: "selected-apps",
        selectedAppIds: ["calendar"],
      }),
    ).toBe(true);
  });
});
