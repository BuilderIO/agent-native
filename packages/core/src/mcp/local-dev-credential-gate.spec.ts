import { describe, expect, it } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import {
  assertOrgCredentialIssuableTo,
  LocalDevOrgCredentialRefusedError,
} from "./local-dev-credential-gate.js";

describe("assertOrgCredentialIssuableTo", () => {
  it("refuses the local development identity with no request context", () => {
    expect(() => assertOrgCredentialIssuableTo("dev@local.test")).toThrow(
      LocalDevOrgCredentialRefusedError,
    );
    expect(() => assertOrgCredentialIssuableTo(" Dev@Local ")).toThrow(
      LocalDevOrgCredentialRefusedError,
    );
  });

  it("refuses the local development identity on a non-loopback request", async () => {
    for (const isLoopbackRequest of [false, undefined]) {
      await runWithRequestContext(
        { userEmail: "dev@local.test", isLoopbackRequest },
        () => {
          expect(() => assertOrgCredentialIssuableTo("dev@local.test")).toThrow(
            expect.objectContaining({ statusCode: 403 }),
          );
        },
      );
    }
  });

  it("refuses the local development identity in a background worker, even with a loopback flag", async () => {
    await runWithRequestContext(
      {
        userEmail: "dev@local.test",
        isLoopbackRequest: true,
        run: { isBackgroundWorker: true },
      },
      () => {
        expect(() => assertOrgCredentialIssuableTo("dev@local.test")).toThrow(
          LocalDevOrgCredentialRefusedError,
        );
      },
    );
  });

  it("allows the local development identity on a loopback request", async () => {
    await runWithRequestContext(
      { userEmail: "dev@local.test", isLoopbackRequest: true },
      () => {
        expect(() =>
          assertOrgCredentialIssuableTo("dev@local.test"),
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
