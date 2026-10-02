import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureException,
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "./index.js";
import { redactErrorStack } from "./redaction.js";

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
