import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureErrorMock = vi.hoisted(() => vi.fn());
const requestIdMock = vi.hoisted(() => vi.fn());

vi.mock("./capture-error.js", () => ({ captureError: captureErrorMock }));
vi.mock("./http-response-telemetry.js", () => ({
  getHttpRequestTelemetryId: requestIdMock,
}));

import {
  isSessionResolutionUnavailable,
  markSessionResolutionUnavailable,
  reportSessionResolutionUnavailable,
  sessionResolutionUnavailableError,
} from "./session-resolution-unavailable.js";

function makeEvent(): any {
  return { context: {} };
}

describe("server/session-resolution-unavailable", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureErrorMock.mockReset().mockReturnValue("capture-1");
    requestIdMock.mockReset().mockReturnValue("req-1");
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("is not unavailable until a lookup failure is recorded", () => {
    const event = makeEvent();
    expect(isSessionResolutionUnavailable(event)).toBe(false);
    markSessionResolutionUnavailable(event, "better-auth", new Error("boom"));
    expect(isSessionResolutionUnavailable(event)).toBe(true);
  });

  it("reports the real cause with the request id, once per request", () => {
    const event = makeEvent();
    const cause = new Error("DB connect timed out after 8000ms");
    markSessionResolutionUnavailable(event, "legacy-cookie", cause);

    reportSessionResolutionUnavailable(event);
    reportSessionResolutionUnavailable(event);

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock).toHaveBeenCalledWith(cause, {
      route: "auth.session-resolution",
      tags: { auth: "session-resolution", source: "legacy-cookie" },
      extra: { request_id: "req-1" },
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[1]).toMatchObject({
      source: "legacy-cookie",
      requestId: "req-1",
      captureId: "capture-1",
    });
  });

  it("keeps the first failure as the cause", () => {
    const event = makeEvent();
    const first = new Error("first");
    markSessionResolutionUnavailable(event, "better-auth", first);
    markSessionResolutionUnavailable(event, "legacy-cookie", new Error("echo"));

    reportSessionResolutionUnavailable(event);

    expect(captureErrorMock.mock.calls[0]?.[0]).toBe(first);
  });

  it("reports nothing when no lookup failed", () => {
    reportSessionResolutionUnavailable(makeEvent());
    expect(captureErrorMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("omits the request id when the request carries none", () => {
    requestIdMock.mockReturnValue(undefined);
    const event = makeEvent();
    markSessionResolutionUnavailable(event, "better-auth", new Error("boom"));

    reportSessionResolutionUnavailable(event);

    expect(captureErrorMock.mock.calls[0]?.[1]).not.toHaveProperty("extra");
  });

  it("treats a bare true flag as unavailable without a cause to report", () => {
    const event = makeEvent();
    event.context.__anSessionResolutionError = true;

    expect(isSessionResolutionUnavailable(event)).toBe(true);
    reportSessionResolutionUnavailable(event);
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("builds a typed, retryable 503", () => {
    expect(sessionResolutionUnavailableError()).toMatchObject({
      statusCode: 503,
      errorCode: "session_unavailable",
      expected: true,
    });
  });
});
