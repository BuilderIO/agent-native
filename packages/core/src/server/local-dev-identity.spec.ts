import { describe, expect, it } from "vitest";

import {
  isLocalDevIdentityEmail,
  LEGACY_LOCAL_DEV_IDENTITY_EMAIL,
  LOCAL_DEV_IDENTITY_EMAIL,
} from "./local-dev-identity.js";

describe("isLocalDevIdentityEmail", () => {
  it("names the AUTH_DISABLED identity and its legacy address", () => {
    expect(LOCAL_DEV_IDENTITY_EMAIL).toBe("dev@local.test");
    expect(LEGACY_LOCAL_DEV_IDENTITY_EMAIL).toBe("dev@local");
  });

  it("matches both addresses, ignoring case and surrounding whitespace", () => {
    expect(isLocalDevIdentityEmail("dev@local.test")).toBe(true);
    expect(isLocalDevIdentityEmail("dev@local")).toBe(true);
    expect(isLocalDevIdentityEmail("  DEV@Local.Test ")).toBe(true);
    expect(isLocalDevIdentityEmail(" Dev@LOCAL")).toBe(true);
  });

  it("rejects other addresses and a missing email", () => {
    expect(isLocalDevIdentityEmail(undefined)).toBe(false);
    expect(isLocalDevIdentityEmail("")).toBe(false);
    expect(isLocalDevIdentityEmail("dev@local.test.example.com")).toBe(false);
    expect(isLocalDevIdentityEmail("admin@example.com")).toBe(false);
    expect(isLocalDevIdentityEmail("dev@localhost")).toBe(false);
  });
});
