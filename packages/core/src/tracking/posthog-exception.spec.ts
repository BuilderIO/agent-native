import { describe, expect, it } from "vitest";

import {
  errorToPostHogExceptionProperties,
  parseStackFrames,
  reshapeTrackedExceptionProperties,
  toPostHogExceptionProperties,
} from "./posthog-exception.js";

const V8_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at resolveOwner (/app/src/server/auth.ts:42:17)",
  "    at async Object.handler (/app/src/routes/api.ts:9:3)",
  "    at /app/node_modules/h3/dist/index.mjs:120:5",
  "    at Socket.socketOnEnd (node:_http_client:526:11)",
].join("\n");

const GECKO_STACK = [
  "resolveOwner@https://example.test/assets/app-a1b2.js:1:2345",
  "@https://example.test/assets/app-a1b2.js:1:99",
].join("\n");

describe("parseStackFrames", () => {
  it("parses V8 frames oldest-call-first and skips the Error header", () => {
    const frames = parseStackFrames(V8_STACK);

    expect(frames.map((f) => f.function)).toEqual([
      "Socket.socketOnEnd",
      "?",
      "Object.handler",
      "resolveOwner",
    ]);
    expect(frames.at(-1)).toMatchObject({
      platform: "custom",
      lang: "javascript",
      function: "resolveOwner",
      filename: "/app/src/server/auth.ts",
      lineno: 42,
      colno: 17,
      in_app: true,
      resolved: false,
    });
  });

  it("marks node internals and node_modules as not in_app", () => {
    const frames = parseStackFrames(V8_STACK);
    const byFile = Object.fromEntries(
      frames.map((f) => [f.filename, f.in_app]),
    );

    expect(byFile["node:_http_client"]).toBe(false);
    expect(byFile["/app/node_modules/h3/dist/index.mjs"]).toBe(false);
    expect(byFile["/app/src/server/auth.ts"]).toBe(true);
  });

  it("parses Gecko/Safari frames including anonymous ones", () => {
    const frames = parseStackFrames(GECKO_STACK);

    expect(frames).toHaveLength(2);
    expect(frames.at(-1)).toMatchObject({
      function: "resolveOwner",
      filename: "https://example.test/assets/app-a1b2.js",
      lineno: 1,
      colno: 2345,
    });
    expect(frames[0]).toMatchObject({ function: "?", lineno: 1, colno: 99 });
  });

  it("returns no frames rather than an empty stack for missing input", () => {
    expect(parseStackFrames(undefined)).toEqual([]);
    expect(parseStackFrames("")).toEqual([]);
  });

  it("skips lines long enough to make the regexes backtrack", () => {
    const frames = parseStackFrames(
      `    at huge (${"x".repeat(1100)}.js:1:1)\n    at small (/app/a.ts:1:1)`,
    );

    expect(frames.map((f) => f.function)).toEqual(["small"]);
  });

  it("caps frames at 50", () => {
    const stack = Array.from(
      { length: 80 },
      (_, i) => `    at fn${i} (/app/f${i}.ts:1:1)`,
    ).join("\n");

    expect(parseStackFrames(stack)).toHaveLength(50);
  });
});

describe("toPostHogExceptionProperties", () => {
  it("builds a $exception_list entry with mechanism and raw stacktrace", () => {
    const props = toPostHogExceptionProperties({
      type: "TypeError",
      value: "boom",
      stack: V8_STACK,
      handled: false,
      mechanismType: "onunhandledrejection",
      level: "fatal",
    });

    expect(props.$exception_level).toBe("fatal");
    expect(props.$exception_list).toHaveLength(1);
    expect(props.$exception_list[0]).toMatchObject({
      type: "TypeError",
      value: "boom",
      mechanism: {
        handled: false,
        synthetic: false,
        type: "onunhandledrejection",
      },
    });
    expect(props.$exception_list[0].stacktrace?.type).toBe("raw");
  });

  it("omits stacktrace entirely when nothing parsed", () => {
    const props = toPostHogExceptionProperties({
      type: "Error",
      value: "no stack here",
    });

    expect(props.$exception_list[0]).not.toHaveProperty("stacktrace");
  });

  it("redacts secrets in the message", () => {
    const props = toPostHogExceptionProperties({
      type: "Error",
      value: "request failed with authorization: Bearer sk-not-a-real-token",
    });

    expect(props.$exception_list[0].value).not.toContain("sk-not-a-real-token");
    expect(props.$exception_list[0].value).toContain("<redacted>");
  });

  it("marks non-Error throws as synthetic", () => {
    const props = errorToPostHogExceptionProperties("just a string");

    expect(props.$exception_list[0].mechanism.synthetic).toBe(true);
  });
});

describe("reshapeTrackedExceptionProperties", () => {
  it("maps the camelCase tracking shape into $exception_list", () => {
    const reshaped = reshapeTrackedExceptionProperties({
      exceptionType: "ValidationError",
      exceptionMessage: "bad input",
      exceptionStack: V8_STACK,
      handled: false,
      level: "warning",
      app: "content",
      runtime: "node",
    });

    expect(reshaped).toMatchObject({
      app: "content",
      runtime: "node",
      $exception_level: "warning",
    });
    expect(reshaped?.$exception_list).toMatchObject([
      {
        type: "ValidationError",
        value: "bad input",
        mechanism: { handled: false },
      },
    ]);
    // The camelCase originals are replaced, not duplicated alongside.
    expect(reshaped).not.toHaveProperty("exceptionType");
    expect(reshaped).not.toHaveProperty("exceptionStack");
  });

  it("passes through properties already in PostHog form", () => {
    const already = { $exception_list: [{ type: "Error", value: "x" }] };

    expect(reshapeTrackedExceptionProperties(already)).toBe(already);
  });

  it("returns undefined when there is nothing exception-shaped to map", () => {
    expect(reshapeTrackedExceptionProperties({ foo: "bar" })).toBeUndefined();
    expect(reshapeTrackedExceptionProperties(undefined)).toBeUndefined();
  });
});
