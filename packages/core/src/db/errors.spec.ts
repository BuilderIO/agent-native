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

  it.each([
    "ECONNREFUSED",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENETDOWN",
    "ECONNABORTED",
    "CONNECT_TIMEOUT",
    "ETIMEDOUT",
  ])("classifies %s only with database provenance", async (code) => {
    const { isTransientDatabaseError } = await import("./errors.js");
    const error = Object.assign(new Error("Fake connection failure"), { code });

    expect(isTransientDatabaseError(error)).toBe(false);
    expect(isTransientDatabaseError(error, { source: "database" })).toBe(true);
    expect(
      isTransientDatabaseError({ cause: error }, { source: "database" }),
    ).toBe(true);
    expect(
      isTransientDatabaseError({
        code,
        stack: "Error: fake outage\n at postgres/connection.js",
      }),
    ).toBe(true);
  });

  it.each(["42501", "42P01", undefined])(
    "keeps permanent and unexpected failures nonretryable with database provenance: %s",
    async (code) => {
      const { isTransientDatabaseError } = await import("./errors.js");
      const error = Object.assign(new Error("Fake database failure"), { code });
      expect(isTransientDatabaseError(error, { source: "database" })).toBe(
        false,
      );
    },
  );

  it.each([
    { code: "ECONNREFUSED", retryable: true },
    { code: "EAI_AGAIN", retryable: true },
    { code: "42501", retryable: false },
    { code: "42P01", retryable: false },
  ])(
    "preserves frozen query errors and provenance for $code",
    async ({ code, retryable }) => {
      const { isTransientDatabaseError, withDatabaseErrorProvenance } =
        await import("./errors.js");
      const cause = Object.freeze(
        Object.assign(new Error("Fake query diagnostics"), { code }),
      );
      expect(isTransientDatabaseError(cause)).toBe(false);
      await expect(
        withDatabaseErrorProvenance(async () => {
          throw cause;
        }),
      ).rejects.toBe(cause);
      expect(isTransientDatabaseError(cause)).toBe(retryable);
      expect(
        isTransientDatabaseError(new Error("Fake wrapper", { cause })),
      ).toBe(retryable);
      expect(
        isTransientDatabaseError(
          Object.assign(new Error("Fake provider transport"), { code }),
        ),
      ).toBe(false);
    },
  );

  it("classifies the driver error a Drizzle query wrapped, not the SQL and params it carries", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm/errors");
    const { isConnectionError, isTransientDatabaseError } =
      await import("./errors.js");
    const driverError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "thread_messages_pkey"',
      ),
      {
        code: "23505",
        stack:
          "error: duplicate key value\n at @neondatabase/serverless/index.mjs:1:1",
      },
    );
    const error = new DrizzleQueryError(
      "insert into thread_messages (content) values ($1)",
      ["The websocket connection closed after a statement timeout"],
      driverError,
    );
    error.stack = `Error: ${error.message}\n at drizzle-orm/pg-core/session.js:41:15`;

    expect(isTransientDatabaseError(error)).toBe(false);
    expect(isConnectionError(error)).toBe(false);
  });

  it.each([
    {
      code: "42501",
      message: "permission denied for table websocket_sessions",
    },
    {
      code: "42703",
      message: 'column "connection_closed_at" does not exist',
    },
    {
      code: "23514",
      message:
        'new row for relation "runs" violates check constraint "runs_socket_hang_up_reason"',
    },
  ])(
    "keeps a $code server error loud even when its text mentions a connection",
    async ({ code, message }) => {
      const { isConnectionError, isTransientDatabaseError } =
        await import("./errors.js");
      const error = Object.assign(new Error(message), {
        code,
        stack: `error: ${message}\n at pg-pool/index.js:45:11`,
      });

      expect(isTransientDatabaseError(error)).toBe(false);
      expect(isTransientDatabaseError(error, { source: "database" })).toBe(
        false,
      );
      expect(isConnectionError(error)).toBe(false);
    },
  );

  it("sees a connection failure that Drizzle wrapped", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm/errors");
    const { isConnectionError, isTransientDatabaseError } =
      await import("./errors.js");
    const error = new DrizzleQueryError(
      "select id from threads where id = $1",
      ["thread-1"],
      new Error("Connection terminated unexpectedly"),
    );

    expect(isConnectionError(error)).toBe(true);
    expect(isTransientDatabaseError(error)).toBe(true);
  });

  it.each(["57P03", "08006", "53300"])(
    "still classifies a Drizzle-wrapped %s as transient",
    async (code) => {
      const { DrizzleQueryError } = await import("drizzle-orm/errors");
      const { isTransientDatabaseError } = await import("./errors.js");
      const error = new DrizzleQueryError(
        "select 1",
        [],
        Object.assign(new Error("Fake outage"), { code }),
      );

      expect(isTransientDatabaseError(error)).toBe(true);
    },
  );

  it("does not classify ordinary database errors as transient", async () => {
    const { isTransientDatabaseError } = await import("./errors.js");

    expect(isTransientDatabaseError(new Error("duplicate key value"))).toBe(
      false,
    );
  });
});
