import { describe, expect, it } from "vitest";

import { canOpenDirectRecordingPage } from "./recording-page-access.js";

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
