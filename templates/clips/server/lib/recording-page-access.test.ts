import { describe, expect, it } from "vitest";

import {
  canReceiveRecordingActivity,
  canOpenDirectRecordingPage,
  isRecordingExpired,
  isRecordingExpiredForViewer,
} from "./recording-page-access.js";

describe("isRecordingExpired", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");

  it("expires recordings whose finite date is in the past", () => {
    expect(isRecordingExpired("2026-07-15T11:59:59.999Z", now)).toBe(true);
  });

  it.each([
    "2026-07-15T12:00:00.001Z",
    "2026-07-16T12:00:00.1Z",
    "2026-07-16T12:00:00.123456Z",
    "2026-07-16",
    "2026-07-16T12:00:00",
    "2026-07-15T11:00:00-02:00",
  ])("keeps future ISO expiry %s available", (expiresAt) => {
    expect(isRecordingExpired(expiresAt, now)).toBe(false);
  });

  it.each(["", null, undefined])(
    "keeps unset expiry %s available",
    (expiresAt) => {
      expect(isRecordingExpired(expiresAt, now)).toBe(false);
    },
  );
});

describe("isRecordingExpiredForViewer", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");

  it.each([
    "not-a-date",
    "2030-02-30T12:00:00Z",
    "12:30:00",
    "123",
    "2030-01-01T00:00:00+23:00",
    "2030-01-01T00:00:00.1234567Z",
  ])(
    "withholds malformed expiry %s from viewers while preserving owner previews",
    (expiresAt) => {
      expect(
        isRecordingExpiredForViewer({ expiresAt, viewerIsOwner: false, now }),
      ).toBe(true);
      expect(
        isRecordingExpiredForViewer({ expiresAt, viewerIsOwner: true, now }),
      ).toBe(false);
    },
  );

  it("keeps an owner's expired recording available", () => {
    expect(
      isRecordingExpiredForViewer({
        expiresAt: "2026-07-15T11:59:59.999Z",
        viewerIsOwner: true,
        now,
      }),
    ).toBe(false);
  });

  it("expires non-owner access after the configured time", () => {
    expect(
      isRecordingExpiredForViewer({
        expiresAt: "2026-07-15T11:59:59.999Z",
        viewerIsOwner: false,
        now,
      }),
    ).toBe(true);
  });
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

describe("canReceiveRecordingActivity", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");
  const recording = {
    ownerEmail: "owner@example.com",
    recipientEmail: "viewer@example.com",
    hasPassword: false,
    now,
  };

  it("rejects activity for expired recordings", () => {
    expect(
      canReceiveRecordingActivity({
        ...recording,
        expiresAt: "2026-07-15T11:59:59.999Z",
      }),
    ).toBe(false);
  });

  it("keeps password-protected activity with the owner", () => {
    expect(
      canReceiveRecordingActivity({
        ...recording,
        recipientEmail: "OWNER@example.com",
        hasPassword: true,
      }),
    ).toBe(true);
  });

  it("rejects password-protected activity for non-owners", () => {
    expect(
      canReceiveRecordingActivity({ ...recording, hasPassword: true }),
    ).toBe(false);
  });
});
