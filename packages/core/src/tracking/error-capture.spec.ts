import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureException,
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "./index.js";
import { redact, redactErrorStack } from "./redaction.js";

describe("tracking captureException", () => {
  afterEach(() => {
    unregisterTrackingProvider("qa-exception");
    vi.unstubAllEnvs();
  });

  it("sends a bounded, redacted Node exception event", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const error = new Error(
      "Request failed authorization=secret-token and bearer abc123",
    );
    error.stack = `${error.stack}\n${"x".repeat(10_000)}`;
    captureException(error, {
      handled: false,
      runtime: "node",
      source: "server",
      route: "/api/recordings",
      tags: { feature: "recording" },
      extra: { authorization: "secret", attempt: 2 },
    });

    expect(track).toHaveBeenCalledTimes(1);
    const [event] = track.mock.calls[0];
    const { properties } = event;
    expect(event.name).toBe("$exception");
    expect(properties).toMatchObject({
      exceptionType: "Error",
      handled: false,
      runtime: "node",
      source: "server",
      url: "/api/recordings",
      exceptionTags: { feature: "recording" },
      exceptionExtra: { authorization: "<redacted>", attempt: 2 },
    });
    expect(properties.exceptionMessage).not.toContain("secret-token");
    expect(properties.exceptionStack.length).toBeLessThanOrEqual(8000);
  });

  it("redacts SQL parameters from exception messages and stacks", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const privateValue = "example transcript content";
    captureException(
      new Error(
        `Failed query: insert into dictations (text) values ($1)\n\tparams: ${privateValue}`,
      ),
    );

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionMessage).toBe(
      "Failed query: insert into dictations (text) values ($1)",
    );
    expect(event.properties.exceptionMessage).not.toContain(privateValue);
    expect(event.properties.exceptionStack).not.toContain(privateValue);
    expect(event.properties.exceptionStack).toMatch(/\n\s+at /);
  });

  it("preserves a redacted stack from non-Error throws", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const privateValue = "example transcript content";
    captureException({
      name: "DrizzleQueryError",
      message: `Failed query: insert into dictations (text) values ($1)\nparams: ${privateValue}`,
      stack: `DrizzleQueryError: Failed query: insert into dictations (text) values ($1)\nparams: ${privateValue}\n    at loadTranscript (server/db.ts:5:7)`,
    });

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionStack).not.toContain(privateValue);
    expect(event.properties.exceptionStack).toContain("at loadTranscript");
  });

  it("redacts raw SQL params behind the Error stack prefix", () => {
    const privateValue = "private customer value";
    const stack = redactErrorStack(
      new Error(
        `SELECT email FROM users WHERE email = $1\n\tparams: ${privateValue}`,
      ),
    );

    expect(stack).toContain("Error: SELECT email FROM users");
    expect(stack).toContain("params: <redacted>");
    expect(stack).not.toContain(privateValue);
    expect(stack).toMatch(/\n\s+at /);
  });

  it("redacts raw SQL params behind a custom error name", () => {
    const privateValue = "private customer value";
    const message = `SELECT email FROM users WHERE email = $1\n\tparams: ${privateValue}`;
    const stack = redactErrorStack({
      name: "DrizzleQueryError",
      message,
      stack: `DrizzleQueryError: ${message}\n    at loadUser (server/db.ts:5:7)`,
    });

    expect(stack).toContain("DrizzleQueryError: SELECT email FROM users");
    expect(stack).toContain("params: <redacted>");
    expect(stack).not.toContain(privateValue);
    expect(stack).toContain("at loadUser");
  });

  it("never forwards a database error's bound parameters", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const error = new Error(
      'Failed query: insert into "users" ("email") values ($1)\nparams: ada.lovelace@example.com',
    );
    captureException(error);

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionMessage).toBe(
      'Failed query: insert into "users" ("email") values ($1)',
    );
    expect(event.properties.exceptionStack).not.toContain("ada.lovelace");
  });

  it("redacts PostgreSQL MERGE bind parameters", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const privateValue = "private customer value";
    captureException(
      new Error(
        `Failed query: merge into customers using staging on customers.id = staging.id\nparams: ${privateValue}`,
      ),
    );

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionMessage).toContain("merge into customers");
    expect(event.properties.exceptionMessage).not.toContain(privateValue);
    expect(event.properties.exceptionStack).not.toContain(privateValue);
  });

  it("redacts PostgreSQL CALL bind parameters", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const privateValue = "private customer value";
    captureException(
      new Error(`Failed query: CALL process_user($1)\nparams: ${privateValue}`),
    );

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionMessage).toContain(
      "Failed query: CALL process_user($1)",
    );
    expect(event.properties.exceptionMessage).not.toContain(privateValue);
    expect(event.properties.exceptionStack).not.toContain(privateValue);
  });

  it.each([
    [
      "SEARCH",
      "WITH RECURSIVE tree(id) AS (SELECT id FROM nodes UNION ALL SELECT id FROM tree WHERE id = $1) SEARCH /* traversal */ DEPTH /* order */ FIRST BY /* keys */ id SET ordercol SELECT id FROM tree WHERE id = $2",
    ],
    [
      "CYCLE",
      "WITH RECURSIVE tree(id) AS (SELECT id FROM nodes UNION ALL SELECT id FROM tree WHERE id = $1) CYCLE /* keys */ id SET /* mark */ is_cycle USING /* path */ path SELECT id FROM tree WHERE id = $2",
    ],
    [
      "SEARCH and CYCLE before another CTE",
      "WITH RECURSIVE tree(id) AS (SELECT id FROM nodes UNION ALL SELECT id FROM tree WHERE id = $1) SEARCH DEPTH FIRST BY id SET ordercol CYCLE id SET is_cycle TO true DEFAULT false USING path, all_nodes AS (SELECT id FROM tree) SELECT id FROM all_nodes WHERE id = $2",
    ],
    [
      "comments inside SEARCH",
      "WITH RECURSIVE tree(id) AS (SELECT id FROM nodes UNION ALL SELECT id FROM tree WHERE id = $1) SEARCH /* traversal */ DEPTH /* order */ FIRST /* columns */ BY id /* output */ SET ordercol SELECT id FROM tree WHERE id = $2",
    ],
    [
      "comments inside CYCLE",
      "WITH RECURSIVE tree(id) AS (SELECT id FROM nodes UNION ALL SELECT id FROM tree WHERE id = $1) CYCLE /* marker */ id SET /* flag */ is_cycle TO true DEFAULT false /* path */ USING /* path column */ path SELECT id FROM tree WHERE id = $2",
    ],
    [
      "comments before the CTE name",
      "WITH /* note */ RECURSIVE /* recursive */ tree(id) AS (SELECT id FROM nodes WHERE id = $1) SELECT id FROM tree",
    ],
    [
      "comments around the CTE name and AS",
      "WITH customer /* name */ (id) /* before AS */ AS /* body */ (SELECT id FROM customers WHERE id = $1) SELECT id FROM customer",
    ],
    [
      "Unicode CTE identifiers",
      "WITH café AS (SELECT id FROM users WHERE email = $1) SELECT * FROM café",
    ],
    [
      "Unicode-escaped CTE identifiers",
      String.raw`WITH U&"caf\00E9" AS (SELECT id FROM users WHERE email = $1) SELECT * FROM U&"caf\00E9"`,
    ],
    [
      "Unicode-escaped CTE identifiers with UESCAPE comments",
      "WITH U&\"caf!00E9\" /* identifier */ UESCAPE /* marker */ '!' /* AS */ AS (SELECT id FROM users WHERE email = $1) SELECT * FROM U&\"caf!00E9\" UESCAPE '!'",
    ],
    [
      "Unicode dollar-quote tags in CTE bodies",
      "WITH data AS (SELECT $é$) ) $é$ AS value) SELECT value FROM data",
    ],
    [
      "dollar signs in unquoted CTE body identifiers",
      "WITH data AS (SELECT col$é$tail FROM users WHERE email = $1) SELECT col$é$tail FROM data",
    ],
    [
      "UESCAPE identifiers and quoted CYCLE values",
      "WITH RECURSIVE tree(id) AS (SELECT id FROM nodes WHERE id = $1 UNION ALL SELECT id FROM tree WHERE id = $1) SEARCH DEPTH FIRST BY U&\"i!0064\" /* column */ UESCAPE /* escape */ '!' SET U&\"order!0063ol\" UESCAPE '!' CYCLE U&\"i!0064\" UESCAPE '!' SET U&\"mark\" UESCAPE '!' TO 'using select' DEFAULT 'not using' USING U&\"path\" UESCAPE '!' SELECT id FROM tree WHERE id = $2",
    ],
  ])("redacts SQL bind parameters in CTEs with %s", (_case, query) => {
    const privateValue = "private customer value";
    const redacted = redact(`${query}\n\tparams: ${privateValue}`);

    expect(redacted).toContain("params: <redacted>");
    expect(redacted).not.toContain(privateValue);
  });

  it.each([
    ["EXECUTE", "EXECUTE prepared_statement($1)"],
    ["COPY", "COPY (SELECT email FROM users WHERE email = $1) TO STDOUT"],
    [
      "DECLARE CURSOR",
      "DECLARE customer_cursor CURSOR FOR SELECT email FROM users WHERE email = $1",
    ],
  ])("redacts PostgreSQL %s bind parameters", (_statement, query) => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const privateValue = "private customer value";
    captureException(
      new Error(`Failed query: ${query}\nparams: ${privateValue}`),
    );

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionMessage).toContain(query);
    expect(event.properties.exceptionMessage).not.toContain(privateValue);
    expect(event.properties.exceptionStack).not.toContain(privateValue);
  });

  it("redacts standalone VALUES bind parameters", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    const privateValue = "private customer value";
    captureException(
      new Error(`Failed query: values ($1)\nparams: ${privateValue}`),
    );

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionMessage).toContain(
      "Failed query: values ($1)",
    );
    expect(event.properties.exceptionMessage).not.toContain(privateValue);
    expect(event.properties.exceptionStack).not.toContain(privateValue);
  });

  it("keeps tags after an undefined one instead of dropping the rest", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    captureException(new Error("boom"), {
      tags: { first: "kept", missing: undefined, second: "also-kept" },
      route: "/api/things",
      method: "POST",
    });

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionTags).toEqual({
      first: "kept",
      second: "also-kept",
      route: "/api/things",
      method: "POST",
    });
  });

  it("keeps the failure packet intact and nested, so the issue page can link the thread", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    captureException(new Error("boom"), {
      extra: {
        failureContext: {
          appId: "calendar",
          threadId: "thr_1",
          runId: "run_1",
          threadUrl: "https://calendar.agent-native.com/?thread=thr_1",
          userScope: "org",
          errorCode: "credential_rejected",
        },
      },
    });

    const [event] = track.mock.calls[0];
    expect(event.properties.exceptionExtra.failureContext).toEqual({
      appId: "calendar",
      threadId: "thr_1",
      runId: "run_1",
      threadUrl: "https://calendar.agent-native.com/?thread=thr_1",
      userScope: "org",
      errorCode: "credential_rejected",
    });
  });

  it("attributes the exception to the caller when a user is known", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    captureException(new Error("boom"), {
      userId: "person@example.test",
      orgId: "org_1",
    });

    const [event] = track.mock.calls[0];
    expect(event.userId).toBe("person@example.test");
    expect(event.properties.orgId).toBe("org_1");
  });

  it("leaves the exception unattributed rather than guessing", () => {
    const track = vi.fn();
    registerTrackingProvider({ name: "qa-exception", track });

    captureException(new Error("boom"));

    const [event] = track.mock.calls[0];
    expect(event.userId).toBeUndefined();
    expect(event.properties).not.toHaveProperty("orgId");
  });
});
