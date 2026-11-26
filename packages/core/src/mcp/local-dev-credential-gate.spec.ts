import { describe, expect, it } from "vitest";

import {
  LEGACY_LOCAL_DEV_IDENTITY_EMAIL,
  LOCAL_DEV_IDENTITY_EMAIL,
} from "../server/local-dev-identity.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  assertOrgCredentialIssuableTo,
  LocalDevOrgCredentialRefusedError,
} from "./local-dev-credential-gate.js";

describe("assertOrgCredentialIssuableTo", () => {
  it("refuses the local development identity with no request context", () => {
    expect(() =>
      assertOrgCredentialIssuableTo(LOCAL_DEV_IDENTITY_EMAIL),
    ).toThrow(LocalDevOrgCredentialRefusedError);
    expect(() =>
      assertOrgCredentialIssuableTo(
        ` ${LEGACY_LOCAL_DEV_IDENTITY_EMAIL.toUpperCase()} `,
      ),
    ).toThrow(LocalDevOrgCredentialRefusedError);
  });

  it("refuses the local development identity on a non-loopback request", async () => {
    for (const isLoopbackRequest of [false, undefined]) {
      await runWithRequestContext(
        { userEmail: LOCAL_DEV_IDENTITY_EMAIL, isLoopbackRequest },
        () => {
          expect(() =>
            assertOrgCredentialIssuableTo(LOCAL_DEV_IDENTITY_EMAIL),
          ).toThrow(expect.objectContaining({ statusCode: 403 }));
        },
      );
    }
  });

  it("refuses the local development identity in a background worker, even with a loopback flag", async () => {
    await runWithRequestContext(
      {
        userEmail: LOCAL_DEV_IDENTITY_EMAIL,
        isLoopbackRequest: true,
        run: { isBackgroundWorker: true },
      },
      () => {
        expect(() =>
          assertOrgCredentialIssuableTo(LOCAL_DEV_IDENTITY_EMAIL),
        ).toThrow(LocalDevOrgCredentialRefusedError);
      },
    );
  });

  it("allows the local development identity on a loopback request", async () => {
    await runWithRequestContext(
      { userEmail: LOCAL_DEV_IDENTITY_EMAIL, isLoopbackRequest: true },
      () => {
        expect(() =>
          assertOrgCredentialIssuableTo(LOCAL_DEV_IDENTITY_EMAIL),
        ).not.toThrow();
      },
    );
  });

  it("allows any other identity with or without a request", async () => {
    expect(() =>
      assertOrgCredentialIssuableTo("admin@example.com"),
    ).not.toThrow();
    await runWithRequestContext(
      { userEmail: "admin@example.com", isLoopbackRequest: false },
      () => {
        expect(() =>
          assertOrgCredentialIssuableTo("admin@example.com"),
        ).not.toThrow();
      },
    );
  });
});
