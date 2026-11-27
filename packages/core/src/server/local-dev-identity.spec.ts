import type { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

vi.mock("./loopback.js", () => ({
  isLoopbackRequest: (event: H3Event) =>
    (event as { loopback?: boolean }).loopback === true,
}));

const { runWithRequestContext } = await import("./request-context.js");
const {
  assertLocalDevCredentialIssuable,
  isLocalDevIdentityEmail,
  LEGACY_LOCAL_DEV_IDENTITY_EMAIL,
  LOCAL_DEV_CREDENTIAL_REFUSED_MESSAGE,
  LOCAL_DEV_IDENTITY_EMAIL,
  LocalDevCredentialRefusedError,
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

// oracle-change(packages/core/src/mcp/local-dev-credential-gate.spec.ts): the org-token gate folded into refusesLocalDevCredential; its cases moved here
describe("refusesLocalDevCredential from the request context", () => {
  it("refuses the dev identity with no request context", () => {
    expect(refusesLocalDevCredential("dev@local.test", "request-context")).toBe(
      true,
    );
  });

  it("refuses the dev identity on a non-loopback request", async () => {
    for (const isLoopbackRequest of [false, undefined]) {
      await runWithRequestContext({ isLoopbackRequest }, () => {
        expect(
          refusesLocalDevCredential(" DEV@Local ", "request-context"),
        ).toBe(true);
      });
    }
  });

  it("allows the dev identity on a loopback request", async () => {
    await runWithRequestContext({ isLoopbackRequest: true }, () => {
      expect(
        refusesLocalDevCredential("dev@local.test", "request-context"),
      ).toBe(false);
    });
  });

  it("never refuses another identity", async () => {
    expect(
      refusesLocalDevCredential("person@example.com", "request-context"),
    ).toBe(false);
    await runWithRequestContext({ isLoopbackRequest: false }, () => {
      expect(
        refusesLocalDevCredential("person@example.com", "request-context"),
      ).toBe(false);
    });
  });
});

describe("refusesLocalDevCredential in a background worker", () => {
  it("refuses the dev identity even when the request reads as loopback", async () => {
    await runWithRequestContext(
      { isLoopbackRequest: true, run: { isBackgroundWorker: true } },
      () => {
        expect(
          refusesLocalDevCredential("dev@local.test", "request-context"),
        ).toBe(true);
        expect(refusesLocalDevCredential("dev@local.test", loopbackEvent)).toBe(
          true,
        );
        expect(
          refusesLocalDevCredential("person@example.com", loopbackEvent),
        ).toBe(false);
      },
    );
  });
});

describe("assertLocalDevCredentialIssuable", () => {
  it("throws a 403 with the shared message exactly when the check refuses", async () => {
    expect(() =>
      assertLocalDevCredentialIssuable("dev@local.test", hostedEvent),
    ).toThrow(LocalDevCredentialRefusedError);
    expect(() =>
      assertLocalDevCredentialIssuable("dev@local.test", "request-context"),
    ).toThrow(
      expect.objectContaining({
        statusCode: 403,
        message: LOCAL_DEV_CREDENTIAL_REFUSED_MESSAGE,
      }),
    );
    expect(() =>
      assertLocalDevCredentialIssuable("dev@local.test", loopbackEvent),
    ).not.toThrow();
    await runWithRequestContext({ isLoopbackRequest: true }, () => {
      expect(() =>
        assertLocalDevCredentialIssuable("dev@local.test", "request-context"),
      ).not.toThrow();
    });
    expect(() =>
      assertLocalDevCredentialIssuable("person@example.com", undefined),
    ).not.toThrow();
  });
});
