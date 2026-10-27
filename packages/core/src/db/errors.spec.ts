import { describe, expect, it } from "vitest";

describe("isTransientDatabaseError", () => {
  it("classifies Neon connection exhaustion as retryable", async () => {
    const { isConnectionError, isTransientDatabaseError } =
      await import("./errors.js");
    const error = {
      code: "EMAXCONN",
      message: "(EMAXCONN) max client connections reached, limit: 200",
      stack:
        "Co: (EMAXCONN) max client connections reached\n at drizzle-orm/neon-serverless",
    };

    expect(isConnectionError(error)).toBe(true);
    expect(isTransientDatabaseError(error)).toBe(true);
    expect(isTransientDatabaseError({ code: "EMAXCONN" })).toBe(true);
  });

  it("classifies statement timeouts without making them connection retries", async () => {
    const { isTransientDatabaseError, isConnectionError } =
      await import("./errors.js");
    const error = new Error("canceling statement due to statement timeout");

    expect(isTransientDatabaseError(error)).toBe(true);
    expect(isConnectionError(error)).toBe(false);
  });

  it("classifies pool checkout timeouts", async () => {
    const { isTransientDatabaseError } = await import("./errors.js");

    expect(isTransientDatabaseError({ code: "ECHECKOUTTIMEOUT" })).toBe(true);
  });

  it("does not misclassify generic provider network failures", async () => {
    const { isTransientDatabaseError } = await import("./errors.js");

    expect(
      isTransientDatabaseError({
        code: "ECONNRESET",
        stack: "Error: socket hang up\n at providerFetch (gong.ts:42:7)",
      }),
    ).toBe(false);
  });

  it("classifies database-driver connection failures", async () => {
    const { isTransientDatabaseError } = await import("./errors.js");

    expect(
      isTransientDatabaseError({
        code: "ECONNRESET",
        stack: "Error: connection reset\n at @neondatabase/serverless/index.js",
      }),
    ).toBe(true);
  });

  it("does not classify ordinary database errors as transient", async () => {
    const { isTransientDatabaseError } = await import("./errors.js");

    expect(isTransientDatabaseError(new Error("duplicate key value"))).toBe(
      false,
    );
  });
});
