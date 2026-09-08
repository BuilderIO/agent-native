import { describe, expect, it } from "vitest";

import {
  errorSignalFromError,
  errorSignalFromSentryEvent,
  shouldReportError,
  shouldReportErrorSignal,
} from "./error-noise-filter.js";

function named(name: string, message: string, stack?: string): Error {
  const error = new Error(message);
  error.name = name;
  if (stack) error.stack = stack;
  return error;
}

describe("shouldReportError (raw Error path)", () => {
  it("drops ValidationError", () => {
    expect(shouldReportError(named("ValidationError", "bad input"))).toBe(
      false,
    );
  });

  it("drops access-control rejections", () => {
    expect(shouldReportError(named("ForbiddenError", "nope"))).toBe(false);
    expect(shouldReportError(named("UnauthorizedError", "nope"))).toBe(false);
  });

  it("drops 4xx HTTPError by status code", () => {
    const error = Object.assign(named("HTTPError", "Not Found"), {
      statusCode: 404,
    });

    expect(shouldReportError(error)).toBe(false);
  });

  it("keeps 5xx HTTPError", () => {
    const error = Object.assign(named("HTTPError", "Upstream exploded"), {
      statusCode: 502,
    });

    expect(shouldReportError(error)).toBe(true);
  });

  it("falls back to message shape when HTTPError carries no status", () => {
    expect(shouldReportError(named("H3Error", "Session not found"))).toBe(
      false,
    );
    expect(shouldReportError(named("H3Error", "Unauthenticated"))).toBe(false);
    expect(shouldReportError(named("H3Error", "database write failed"))).toBe(
      true,
    );
  });

  it("drops Lambda socket hang up rejections parsed from a real stack", () => {
    const error = named(
      "Error",
      "socket hang up",
      [
        "Error: socket hang up",
        "    at Socket.socketOnEnd (node:_http_client:526:11)",
        "    at endReadableNT (node:internal/streams/readable:1400:12)",
      ].join("\n"),
    );

    expect(
      shouldReportError(error, { mechanismType: "onunhandledrejection" }),
    ).toBe(false);
  });

  it("keeps socket hang up that is not an unhandled rejection", () => {
    const error = named(
      "Error",
      "socket hang up",
      "Error: socket hang up\n    at Socket.socketOnEnd (node:_http_client:526:11)",
    );

    expect(shouldReportError(error)).toBe(true);
  });

  it("keeps application socket errors without an http-client frame", () => {
    const error = named(
      "Error",
      "socket hang up",
      "Error: socket hang up\n    at proxyUpstream (/app/src/proxy.ts:9:1)",
    );

    expect(
      shouldReportError(error, { mechanismType: "onunhandledrejection" }),
    ).toBe(true);
  });

  it("reports ordinary errors", () => {
    expect(shouldReportError(named("TypeError", "x is not a function"))).toBe(
      true,
    );
  });

  it("reports non-Error throws rather than guessing", () => {
    expect(shouldReportError("something threw a string")).toBe(true);
  });

  it("honours a validation tag without relying on the class name", () => {
    expect(
      shouldReportError(new Error("bad input"), {
        tags: { handled: "validation" },
      }),
    ).toBe(false);
  });
});

describe("errorSignalFromError", () => {
  it("reads statusCode from either statusCode or status", () => {
    expect(
      errorSignalFromError(Object.assign(new Error("x"), { status: "418" }))
        .statusCode,
    ).toBe(418);
    expect(
      errorSignalFromError(Object.assign(new Error("x"), { statusCode: 500 }))
        .statusCode,
    ).toBe(500);
  });

  it("leaves statusCode undefined when the error carries none", () => {
    expect(errorSignalFromError(new Error("x")).statusCode).toBeUndefined();
  });
});

describe("errorSignalFromSentryEvent", () => {
  it("normalizes the first exception value with its frames and mechanism", () => {
    const signal = errorSignalFromSentryEvent({
      exception: {
        values: [
          {
            type: "Error",
            value: "socket hang up",
            mechanism: { type: "auto.node.onunhandledrejection" },
            stacktrace: { frames: [{ filename: "node:_http_client" }] },
          },
        ],
      },
      tags: { statusCode: "404" },
    });

    expect(signal).toMatchObject({
      type: "Error",
      value: "socket hang up",
      mechanismType: "auto.node.onunhandledrejection",
      statusCode: 404,
      hasExceptionValues: true,
    });
    expect(shouldReportErrorSignal(signal)).toBe(false);
  });

  it("reports metadata-only events that are not the SDK ErrorEvent shape", () => {
    const signal = errorSignalFromSentryEvent({
      metadata: { value: "[object ErrorEvent]", filename: "/app/src/app.ts" },
      exception: { values: [] },
    });

    expect(signal.hasExceptionValues).toBe(false);
    expect(shouldReportErrorSignal(signal)).toBe(true);
  });
});
