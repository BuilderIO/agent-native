import { describe, expect, it } from "vitest";

import { withDatabaseErrorProvenance } from "../db/errors.js";
import { ForbiddenError } from "../sharing/errors.js";
import {
  SessionResolutionLookupError,
  SessionResolutionUnavailableError,
  sessionResolutionFailure,
} from "./session-resolution-errors.js";

describe("session resolution failure contract", () => {
  it.each(["57014", "08006"])(
    "makes transient membership failure %s retryable without exposing its message",
    (code) => {
      const cause = Object.assign(
        new Error("fake private membership diagnostic"),
        {
          code,
        },
      );
      const error = sessionResolutionFailure(cause);

      expect(error).toBeInstanceOf(SessionResolutionUnavailableError);
      expect(error).toMatchObject({
        name: "SessionResolutionUnavailableError",
        message: "Session unavailable",
        statusCode: 503,
        headers: { "Retry-After": "5" },
      });
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(cause.message);
    },
  );

  it.each(["ECONNREFUSED", "EAI_AGAIN", "CONNECT_TIMEOUT", "ETIMEDOUT"])(
    "keeps known database transport %s retryable",
    async (code) => {
      const cause = Object.assign(
        new Error("Fake private network diagnostics"),
        { code },
      );
      await expect(
        withDatabaseErrorProvenance(async () => {
          throw cause;
        }),
      ).rejects.toBe(cause);
      const error = sessionResolutionFailure(cause);
      expect(error).toMatchObject({
        statusCode: 503,
        headers: { "Retry-After": "5" },
      });
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(cause.message);
      const providerFailure = Object.assign(
        new Error("Fake provider transport"),
        { code },
      );
      expect(sessionResolutionFailure(providerFailure)).toMatchObject({
        statusCode: 500,
      });
    },
  );

  it.each([
    Object.assign(new Error("fake permission diagnostic"), { code: "42501" }),
    Object.assign(new Error("fake schema diagnostic"), { code: "42P01" }),
    new TypeError("fake unexpected diagnostic"),
    "fake non-Error diagnostic",
    null,
    false,
  ])("keeps permanent or unclassified failure %s nonretryable", (cause) => {
    const error = sessionResolutionFailure(cause);

    expect(error).toBeInstanceOf(SessionResolutionLookupError);
    expect(error).toMatchObject({
      name: "SessionResolutionLookupError",
      message: "Internal server error",
      statusCode: 500,
    });
    expect(error).not.toHaveProperty("headers");
    expect(error.cause).toBe(cause);
  });

  it.each([
    new ForbiddenError(),
    new SessionResolutionUnavailableError(),
    new SessionResolutionLookupError(new Error("fake retained cause")),
  ])("preserves the identity of an already classified %s", (cause) => {
    expect(sessionResolutionFailure(cause)).toBe(cause);
  });
});
