import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import {
  isConnectionError,
  isRetryableConnectionError,
  isTransientDatabaseError as isTransient,
} from "./errors.js";

const withCode = (code: string, message = "boom") =>
  Object.assign(new Error(message), { code });

describe("SQLSTATE classification", () => {
  it.each(["X42501", "425010", "42501X", "4250", "42-01", "42a01", "9A001"])(
    "does not treat %s as a SQLSTATE, so a connection message still counts",
    (code) => {
      const err = withCode(code, "connection terminated unexpectedly");
      expect(isConnectionError(err)).toBe(true);
    },
  );

  it.each(["23505", "42501", "0A000", "F0000", "HV000", "P0001", "XX000"])(
    "treats %s as a SQLSTATE answered by the server, never a connection error",
    (code) => {
      const err = withCode(code, "connection closed");
      expect(isConnectionError(err)).toBe(false);
      expect(isTransient(err, { source: "database" })).toBe(false);
    },
  );

  it.each(["08000", "08006", "08P01", "53300", "57014", "57P01", "57P02"])(
    "keeps transient SQLSTATE %s retryable",
    (code) => {
      expect(isTransient(withCode(code), { source: "database" })).toBe(true);
    },
  );

  it.each(["57P04", "57P00", "157P01", "57P011", "1080006", "0900", "09000"])(
    "does not treat %s as transient",
    (code) => {
      expect(isTransient(withCode(code), { source: "database" })).toBe(false);
    },
  );

  it("reads the code from the cause when the error has none", () => {
    const err = Object.assign(new Error("x"), { cause: { code: "23505" } });
    expect(isConnectionError(err)).toBe(false);
    expect(isTransient(err, { source: "database" })).toBe(false);
    const down = Object.assign(new Error("x"), { cause: { code: "08006" } });
    expect(isTransient(down)).toBe(true);
  });
});

describe("driverError unwrapping", () => {
  const cause = () => new Error("duplicate key");
  const hostile = "connection closed websocket ETIMEDOUT";

  it("unwraps a query, params and cause wrapper", () => {
    const err = new DrizzleQueryError("select 1", [hostile], cause());
    expect(isConnectionError(err)).toBe(false);
  });

  it.each([
    ["no query", { params: [], cause: cause() }],
    ["a non-string query", { query: 1, params: [], cause: cause() }],
    ["no params", { query: "select 1", cause: cause() }],
    ["non-array params", { query: "select 1", params: {}, cause: cause() }],
    ["no cause", { query: "select 1", params: [] }],
    ["a null cause", { query: "select 1", params: [], cause: null }],
  ])("does not unwrap an object with %s", (_name, extra) => {
    const err = Object.assign(new Error(hostile), extra);
    expect(isConnectionError(err)).toBe(true);
  });

  it("does not unwrap a primitive or null", () => {
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
    expect(isRetryableConnectionError(null)).toBe(false);
    expect(isRetryableConnectionError(undefined)).toBe(false);
    expect(isRetryableConnectionError("ECONNREFUSED")).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("isRetryableConnectionError", () => {
  const refusals = ["57P03", "08001", "08004", "ECONNREFUSED", "EAI_AGAIN"];

  it.each(refusals)("retries %s directly", (code) => {
    expect(isRetryableConnectionError(withCode(code))).toBe(true);
  });

  it.each(refusals)("retries %s in cause", (code) => {
    const err = Object.assign(new Error("x"), { cause: { code } });
    expect(isRetryableConnectionError(err)).toBe(true);
  });

  it.each(refusals)("retries a Drizzle-wrapped %s", (code) => {
    const err = new DrizzleQueryError("select 1", [], withCode(code));
    expect(isRetryableConnectionError(err)).toBe(true);
  });

  it("retries ordinary connection errors", () => {
    expect(isRetryableConnectionError(withCode("ECONNRESET"))).toBe(true);
    expect(isRetryableConnectionError(new Error("Connection terminated"))).toBe(
      true,
    );
  });

  it.each([
    "23505",
    "42501",
    "08003",
    "08006",
    "57P01",
    "ENETUNREACH",
    "ECONNABORTED",
    "EHOSTUNREACH",
    "",
    "Stryker was here",
  ])("does not retry %s", (code) => {
    expect(isRetryableConnectionError(withCode(code, "plain failure"))).toBe(
      false,
    );
  });

  it("does not retry a wrapper whose query is not unwrapped", () => {
    const err = Object.assign(new Error("plain"), {
      query: "select 1",
      params: [],
      code: "23505",
    });
    expect(isRetryableConnectionError(err)).toBe(false);
  });

  it("does not retry an error without a code", () => {
    expect(isRetryableConnectionError(new Error("plain"))).toBe(false);
    expect(isRetryableConnectionError({})).toBe(false);
  });
});

describe("isTransientDatabaseError origin", () => {
  const dropped = () => new Error("Connection terminated unexpectedly");

  it("needs a database origin for a bare connection error", () => {
    expect(isTransient(dropped())).toBe(false);
    expect(isTransient(dropped(), { source: "database" })).toBe(true);
  });

  it("trusts a connection error found inside a Drizzle wrapper", () => {
    const err = new DrizzleQueryError("select 1", [], dropped());
    expect(isTransient(err)).toBe(true);
  });

  it("trusts a refused connection error inside a Drizzle wrapper", () => {
    const err = new DrizzleQueryError("select 1", [], withCode("ECONNREFUSED"));
    expect(isTransient(err)).toBe(true);
    expect(isTransient(withCode("ECONNREFUSED"))).toBe(false);
  });

  it("trusts a connection error tagged with database provenance", async () => {
    const { withDatabaseErrorProvenance } = await import("./errors.js");
    const err = dropped();
    await expect(
      withDatabaseErrorProvenance(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(isTransient(err)).toBe(true);
  });
});

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
