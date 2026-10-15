import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorReply,
  parseIngestBody,
  parseJsonBody,
  requestError,
} from "./request-errors.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorReply", () => {
  it("returns an error raised for the caller as written", () => {
    expect(
      errorReply(requestError("Missing publicKey", 400), "[test]"),
    ).toEqual({ statusCode: 400, error: "Missing publicKey" });
  });

  it("logs any other failure and replies without its details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error(
      'Failed query: insert into "analytics_events" params: evt_1,internal-detail',
    );

    expect(errorReply(failure, "[test]")).toEqual({
      statusCode: 500,
      error: "Internal server error",
    });
    expect(errorReply("internal-detail", "[test]")).toEqual({
      statusCode: 500,
      error: "Internal server error",
    });
    expect(log).toHaveBeenCalledWith(
      "[test] Unexpected request failure:",
      failure,
    );
  });
});

describe("parseJsonBody", () => {
  it("reports malformed JSON as the caller's error", () => {
    expect(parseJsonBody('{"event":"pageview"}')).toEqual({
      event: "pageview",
    });
    expect(() => parseJsonBody("{not json")).toThrow(
      expect.objectContaining({
        statusCode: 400,
        message: "Request body is not valid JSON",
      }),
    );
  });
});

describe("parseIngestBody", () => {
  it("rejects keys that would clean to the same key instead of dropping one", () => {
    expect(
      parseIngestBody('{"a":{"note\\u0000":1,"tag":2},"__proto__":{"x":1}}'),
    ).toEqual(JSON.parse('{"a":{"note":1,"tag":2},"__proto__":{"x":1}}'));
    expect(() =>
      parseIngestBody('{"properties":{"note\\u0000":1,"note":2}}'),
    ).toThrow(
      expect.objectContaining({
        statusCode: 400,
        message:
          "Request body has keys that differ only by characters Postgres cannot store",
      }),
    );
  });
});
