import type { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

vi.mock("./loopback.js", () => ({
  isLoopbackRequest: (event: H3Event) =>
    (event as { loopback?: boolean }).loopback === true,
}));

const {
  isLocalDevIdentityEmail,
  LEGACY_LOCAL_DEV_IDENTITY_EMAIL,
  LOCAL_DEV_IDENTITY_EMAIL,
  refusesLocalDevCredential,
} = await import("./local-dev-identity.js");

const loopbackEvent = { loopback: true } as unknown as H3Event;
const hostedEvent = { loopback: false } as unknown as H3Event;

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

describe("refusesLocalDevCredential", () => {
  it("allows the dev identity on a loopback request", () => {
    expect(refusesLocalDevCredential("dev@local.test", loopbackEvent)).toBe(
      false,
    );
  });

  it("refuses the dev identity off loopback", () => {
    expect(refusesLocalDevCredential("dev@local.test", hostedEvent)).toBe(true);
    expect(refusesLocalDevCredential("dev@local", hostedEvent)).toBe(true);
  });

  it("refuses the dev identity when there is no request to check", () => {
    expect(refusesLocalDevCredential("dev@local.test", undefined)).toBe(true);
  });

  it("never refuses another identity", () => {
    expect(refusesLocalDevCredential("person@example.com", hostedEvent)).toBe(
      false,
    );
    expect(refusesLocalDevCredential("person@example.com", undefined)).toBe(
      false,
    );
  });
});
