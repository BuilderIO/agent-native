import { describe, expect, it } from "vitest";

import {
  canOpenDirectRecordingPage,
  isRecordingExpired,
} from "./recording-page-access.js";

describe("isRecordingExpired", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");

  it("expires recordings whose finite date is in the past", () => {
    expect(isRecordingExpired("2026-07-15T11:59:59.999Z", now)).toBe(true);
  });

  it("keeps recordings with a future finite date available", () => {
    expect(isRecordingExpired("2026-07-15T12:00:00.001Z", now)).toBe(false);
  });

  it.each(["not-a-date", "", null, undefined])(
    "ignores non-finite or unset expiry %s",
    (expiresAt) => {
      expect(isRecordingExpired(expiresAt, now)).toBe(false);
    },
  );
});

describe("canOpenDirectRecordingPage", () => {
  it("always allows the owner, including for password-protected recordings", () => {
    expect(
      canOpenDirectRecordingPage({
        role: "owner",
        visibility: "public",
        hasPassword: true,
        hasExplicitShare: false,
      }),
    ).toBe(true);
  });

  it("rejects non-owner access to password-protected recordings", () => {
    expect(
      canOpenDirectRecordingPage({
        role: "viewer",
        visibility: "public",
        hasPassword: true,
        hasExplicitShare: true,
      }),
    ).toBe(false);
  });

  it("rejects public-link-only access on the direct recording route", () => {
    expect(
      canOpenDirectRecordingPage({
        role: "viewer",
        visibility: "public",
        hasPassword: false,
        hasExplicitShare: false,
      }),
    ).toBe(false);
  });

  it("allows an explicit public recording share without a password", () => {
    expect(
      canOpenDirectRecordingPage({
        role: "viewer",
        visibility: "public",
        hasPassword: false,
        hasExplicitShare: true,
      }),
    ).toBe(true);
  });

  it("preserves direct access for non-public recordings already shared to the viewer", () => {
    expect(
      canOpenDirectRecordingPage({
        role: "viewer",
        visibility: "private",
        hasPassword: false,
        hasExplicitShare: true,
      }),
    ).toBe(true);
  });
});
