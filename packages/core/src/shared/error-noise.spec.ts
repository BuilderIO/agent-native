import { describe, expect, it } from "vitest";

import {
  analyzeErrorOrigin,
  classifyErrorNoise,
  isTestHarnessError,
  isThirdPartyFrameFile,
  isWrapperFrame,
  parseErrorStackFrames,
  REPORT_EXPECTED_FAILURE_TAG,
  scrubUserPaths,
  stripAnsi,
  stripSqlParams,
  type ErrorNoiseSignal,
} from "./error-noise.js";

const PAGE = "https://slides.agent-native.com";

function browser(
  overrides: Partial<ErrorNoiseSignal> & { stack?: string },
): ErrorNoiseSignal {
  return {
    surface: "browser",
    type: "TypeError",
    value: "boom",
    firstPartyHosts: ["slides.agent-native.com"],
    pageUrl: `${PAGE}/home`,
    ...overrides,
  };
}

function reason(signal: ErrorNoiseSignal): string | null {
  const verdict = classifyErrorNoise(signal);
  return verdict.drop ? verdict.reason : null;
}

describe("parseErrorStackFrames", () => {
  it("parses V8 frames innermost first and skips the header", () => {
    const frames = parseErrorStackFrames(
      [
        "TypeError: boom",
        "    at doThing (https://app.example.com/assets/main.js:12:34)",
        "    at async handler (https://app.example.com/assets/main.js:40:1)",
        "    at https://cdn.vector.co/pixel.js:2:15",
      ].join("\n"),
    );
    expect(frames).toEqual([
      {
        function: "doThing",
        filename: "https://app.example.com/assets/main.js",
        lineno: 12,
      },
      {
        function: "handler",
        filename: "https://app.example.com/assets/main.js",
        lineno: 40,
      },
      { filename: "https://cdn.vector.co/pixel.js", lineno: 2 },
    ]);
  });

  it("parses Gecko/Safari fn@location frames", () => {
    const frames = parseErrorStackFrames(
      "doThing@https://app.example.com/main.js:12:34\n@debugger eval code:1:1",
    );
    expect(frames[0]).toMatchObject({ function: "doThing", lineno: 12 });
    expect(frames).toHaveLength(2);
  });

  it("never turns a database error's params line into a frame", () => {
    const v8 = [
      'Error: Failed query: insert into "users" ("email") values ($1)',
      "params: ada.lovelace@example.com,second@example.com",
      "    at runQuery (/var/task/_chunks/db.mjs:10:5)",
    ].join("\n");
    expect(parseErrorStackFrames(v8)).toEqual([
      {
        function: "runQuery",
        filename: "/var/task/_chunks/db.mjs",
        lineno: 10,
      },
    ]);
    const gecko = "params: ada@example.com,x@y.z\nrun@https://a.test/b.js:1:2";
    expect(parseErrorStackFrames(gecko).map((f) => f.function)).toEqual([
      "run",
    ]);
  });

  it("returns no frames for blank input", () => {
    expect(parseErrorStackFrames(undefined)).toEqual([]);
    expect(parseErrorStackFrames("")).toEqual([]);
  });
});

describe("frame origin helpers", () => {
  it("recognises our fetch wrappers but not ordinary frames", () => {
    expect(isWrapperFrame({ function: "window.fetch" })).toBe(true);
    expect(isWrapperFrame({ function: "fetch" })).toBe(true);
    expect(
      isWrapperFrame({ filename: "https://a.test/assets/api-path-Bx1.js" }),
    ).toBe(true);
    expect(isWrapperFrame({ function: "loadDashboard" })).toBe(false);
    expect(isWrapperFrame({ function: "fetchDashboard" })).toBe(false);
  });

  it("flags extension, GTM, and known vendor files as third-party", () => {
    expect(
      isThirdPartyFrameFile("chrome-extension://abc/executors/200.js"),
    ).toBe(true);
    expect(isThirdPartyFrameFile("moz-extension://abc/x.js")).toBe(true);
    expect(isThirdPartyFrameFile("injectScriptAdjust.js")).toBe(true);
    expect(isThirdPartyFrameFile("https://cdn.vector.co/pixel.js")).toBe(true);
    expect(
      isThirdPartyFrameFile("https://www.googletagmanager.com/gtm.js?id=GTM-1"),
    ).toBe(true);
    expect(isThirdPartyFrameFile("gtm.js")).toBe(true);
    expect(isThirdPartyFrameFile("https://slides.agent-native.com/a.js")).toBe(
      false,
    );
    expect(isThirdPartyFrameFile("/var/task/_chunks/x.mjs")).toBe(false);
    expect(isThirdPartyFrameFile(undefined)).toBe(false);
  });

  it("only calls an unknown host foreign when it knows where our assets live", () => {
    const frames = [{ filename: "https://static.unknown-vendor.io/p.js" }];
    expect(analyzeErrorOrigin(frames).firstParty).toBe(1);
    expect(
      analyzeErrorOrigin(frames, ["slides.agent-native.com"]).thirdParty,
    ).toBe(1);
    // A sibling host of ours is never foreign.
    expect(
      analyzeErrorOrigin(
        [{ filename: "https://clips.agent-native.com/a.js" }],
        ["slides.agent-native.com"],
      ).firstParty,
    ).toBe(1);
  });
});

describe("classifyErrorNoise — browser", () => {
  it("drops the Vector pixel's 'Domain not allowed' rejection", () => {
    expect(
      reason(
        browser({
          type: "UnhandledRejection",
          value: "Domain not allowed",
          stack:
            "Error: Domain not allowed\n    at https://cdn.vector.co/pixel.js:2:15234",
        }),
      ),
    ).toBe("third-party-origin");
  });

  it("attributes a vendor fetch failure to the vendor, not to our fetch wrapper", () => {
    expect(
      reason(
        browser({
          value: "Failed to fetch (api.vector.co)",
          stack: [
            "TypeError: Failed to fetch (api.vector.co)",
            "    at window.fetch (https://slides.agent-native.com/assets/api-path-Bx1.js:1:2210)",
            "    at https://cdn.vector.co/pixel.js:2:9876",
          ].join("\n"),
        }),
      ),
    ).toBe("third-party-origin");
  });

  it("drops opaque cross-origin 'Script error.' events", () => {
    expect(reason(browser({ type: "Error", value: "Script error." }))).toBe(
      "opaque-script-error",
    );
    expect(reason(browser({ type: "Error", value: "Script error" }))).toBe(
      "opaque-script-error",
    );
  });

  it("drops events whose every frame is line 0 (injected or eval'd code)", () => {
    expect(
      reason(
        browser({
          value: "lintrk is not a function",
          stack: "TypeError: x\n    at gtm.js:0:0",
        }),
      ),
    ).not.toBeNull();
    expect(
      reason(
        browser({
          value: "something odd",
          stack:
            "Error: x\n    at https://slides.agent-native.com/inline.js:0:0",
        }),
      ),
    ).toBe("opaque-zero-line-stack");
  });

  it("drops a Chrome stale-chunk failure even though its stack is only the header line", () => {
    const value =
      "Failed to fetch dynamically imported module: https://beta.slides.agent-native.com/assets/AgentSidebarPanel-3f2a.js";
    expect(reason(browser({ value, stack: `TypeError: ${value}` }))).toBe(
      "stale-chunk",
    );
    expect(reason(browser({ value }))).toBe("stale-chunk");
    expect(
      reason(
        browser({
          type: "Error",
          value: "Importing a module script failed.",
        }),
      ),
    ).toBe("stale-chunk");
  });

  it("drops errors thrown from a browser extension with no frame of ours", () => {
    expect(
      reason(
        browser({
          value: "Cannot read properties of undefined (reading 'M_ID')",
          stack:
            "TypeError: x\n    at e (chrome-extension://abcdef/executors/200.js:1:2)",
        }),
      ),
    ).toBe("extension-origin");
  });

  it("keeps an extension-adjacent error when our own code is in the stack", () => {
    expect(
      reason(
        browser({
          value: "Cannot read properties of undefined (reading 'x')",
          stack: [
            "TypeError: x",
            "    at renderRow (https://slides.agent-native.com/assets/Home-9f.js:10:3)",
            "    at e (chrome-extension://abcdef/executors/200.js:1:2)",
          ].join("\n"),
        }),
      ),
    ).toBeNull();
  });

  it("drops extension fetch failures even with a destination suffix", () => {
    expect(
      reason(
        browser({
          value: "Failed to fetch (api2.amplitude.com)",
          stack:
            "TypeError: Failed to fetch (api2.amplitude.com)\n    at fetch (chrome-extension://test/frame_ant.js:1:1)",
        }),
      ),
    ).toBe("extension-network");
    expect(
      reason(
        browser({
          value: "Failed to fetch",
          stack:
            "TypeError: Failed to fetch\n    at ViJh (injectScriptAdjust.js:1:1)",
        }),
      ),
    ).toBe("extension-network");
  });

  it("drops the Amplitude SDK's own failed requests even though the SDK ships in our bundle", () => {
    expect(
      reason(
        browser({
          value: "Failed to fetch (api2.amplitude.com)",
          stack: [
            "TypeError: Failed to fetch (api2.amplitude.com)",
            "    at send (https://slides.agent-native.com/assets/amplitude-Ab12.js:1:100)",
          ].join("\n"),
        }),
      ),
    ).toBe("amplitude-network");
    expect(
      reason(
        browser({
          value: "Failed to fetch",
          stack:
            "TypeError: x\n    at s (https://slides.agent-native.com/a.js:1:1)",
          contextText: "POST https://api2.amplitude.com/2/httpapi",
        }),
      ),
    ).toBe("amplitude-network");
  });

  it("drops unattributable network failures but keeps ones our code issued", () => {
    for (const value of [
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
    ]) {
      expect(reason(browser({ value }))).toBe("unattributable-network");
    }
    // Only our wrapper in the stack: still nothing says who called it.
    expect(
      reason(
        browser({
          value: "Failed to fetch",
          stack:
            "TypeError: Failed to fetch\n    at window.fetch (https://slides.agent-native.com/assets/api-path-Bx1.js:1:1)",
        }),
      ),
    ).toBe("unattributable-network");
    expect(
      reason(
        browser({
          value: "Failed to fetch",
          stack:
            "TypeError: Failed to fetch\n    at loadDashboard (https://slides.agent-native.com/assets/app.js:10:2)",
        }),
      ),
    ).toBeNull();
  });

  it("keeps Message-like and unknown errors loudly", () => {
    expect(
      reason(
        browser({
          type: "Error",
          value: "Cannot save deck: quota exceeded",
          stack:
            "Error: x\n    at save (https://slides.agent-native.com/a.js:5:5)",
        }),
      ),
    ).toBeNull();
    expect(reason(browser({ type: "Error", value: "weird thing" }))).toBeNull();
  });

  it("keeps the Sentry-era browser rules", () => {
    expect(
      reason(
        browser({
          type: "AbortError",
          value: "signal is aborted without reason",
        }),
      ),
    ).toBe("benign-abort");
    expect(
      reason(browser({ type: "AgentAutoContinueSignal", value: "x" })),
    ).toBe("agent-auto-continue");
    expect(reason(browser({ type: "Error", value: "Unauthorized" }))).toBe(
      "access-control",
    );
    expect(
      reason(
        browser({
          type: "ReferenceError",
          value: "Can't find variable: EmptyRanges",
        }),
      ),
    ).toBe("sourceless-emptyranges");
    expect(
      reason(
        browser({
          type: "Error",
          value: "x",
          tags: {
            context: "agent-native-chat",
            errorCode: "run_timeout",
            reconnectTimedOut: "false",
            reconnectTerminalReason: "run_timeout",
          },
        }),
      ),
    ).toBe("run-timeout-reconnect");
    expect(
      reason(
        browser({
          type: "RangeError",
          value: "Maximum call stack size exceeded",
          pageUrl: "https://www.agent-native.com/docs",
        }),
      ),
    ).toBe("docs-sourceless-stack-overflow");
    expect(
      reason(
        browser({
          type: "RangeError",
          value: "Maximum call stack size exceeded",
          stack:
            "RangeError: x\n    at f (https://slides.agent-native.com/a.js:1:1)",
        }),
      ),
    ).toBeNull();
  });
});

describe("classifyErrorNoise — explicit captures that name their origin", () => {
  it("keeps a stackless network failure that carries a first-party tag", () => {
    const value = "NetworkError when attempting to fetch resource.";
    expect(reason(browser({ value }))).toBe("unattributable-network");
    expect(
      reason(browser({ value, tags: { context: "agent-native-chat" } })),
    ).toBeNull();
    expect(
      reason(browser({ value, tags: { area: "slides-save" } })),
    ).toBeNull();
    // Auto-added tags are not provenance.
    expect(
      reason(
        browser({ value, tags: { deployment_environment: "production" } }),
      ),
    ).toBe("unattributable-network");
    expect(reason(browser({ value, tags: { context: "  " } }))).toBe(
      "unattributable-network",
    );
  });

  it("reports an access-control or 4xx failure only when the caller marks it", () => {
    const forbidden = {
      surface: "server",
      type: "ForbiddenError",
      value: "Grant for automation was revoked",
    } as const;
    const http404 = {
      surface: "server",
      type: "HTTPError",
      value: "Not Found",
      statusCode: 404,
    } as const;
    expect(reason(forbidden)).toBe("access-control");
    expect(reason(http404)).toBe("expected-http");
    expect(
      reason({ ...forbidden, tags: { [REPORT_EXPECTED_FAILURE_TAG]: "true" } }),
    ).toBeNull();
    expect(
      reason({ ...http404, tags: { [REPORT_EXPECTED_FAILURE_TAG]: "true" } }),
    ).toBeNull();
    // The marker lifts only the "expected" rules, never validation noise.
    expect(
      reason({
        surface: "server",
        type: "ValidationError",
        value: "bad",
        tags: { [REPORT_EXPECTED_FAILURE_TAG]: "true" },
      }),
    ).toBe("validation");
  });
});

describe("classifyErrorNoise — server", () => {
  it("applies the server rules and none of the browser ones", () => {
    expect(
      reason({ surface: "server", type: "ValidationError", value: "bad" }),
    ).toBe("validation");
    expect(
      reason({ surface: "server", type: "ForbiddenError", value: "no" }),
    ).toBe("access-control");
    expect(
      reason({
        surface: "server",
        type: "HTTPError",
        value: "Not Found",
        statusCode: 404,
      }),
    ).toBe("expected-http");
    // A server-side failed fetch is a real failure, not browser noise.
    expect(
      reason({
        surface: "server",
        type: "TypeError",
        value: "Failed to fetch",
      }),
    ).toBeNull();
    expect(
      reason({ surface: "server", type: "Error", value: "Script error." }),
    ).toBeNull();
  });

  it("never drops the incident classes we need to see", () => {
    for (const value of [
      "password authentication failed for user 'neondb_owner'",
      'ensureSchemaObject: could not probe required schema "table application_state"',
    ]) {
      expect(reason({ surface: "server", type: "Error", value })).toBeNull();
    }
    expect(
      reason({
        surface: "server",
        type: "MissingAuthSecretError",
        value: "[agent-native] production configuration errors:",
      }),
    ).toBeNull();
  });

  it("drops the fuzz-harness label on every surface", () => {
    for (const surface of ["browser", "server"] as const) {
      expect(
        reason({
          surface,
          type: "Error",
          value: "fuzz-intercepted-process-exit",
        }),
      ).toBe("test-harness");
    }
    expect(
      isTestHarnessError({
        value: "x",
        stack:
          "at process.fuzzInterceptedProcessExit [as exit] (fuzz-exports.js:98:9)",
      }),
    ).toBe(true);
    expect(isTestHarnessError({ value: "real failure" })).toBe(false);
  });
});

describe("scrubbers", () => {
  it("strips drizzle params lines from messages and stacks", () => {
    expect(
      stripSqlParams(
        "Failed query: select 1 where email = $1\nparams: ada@example.com\n    at x (a.js:1:1)",
      ),
    ).toBe("Failed query: select 1 where email = $1\n    at x (a.js:1:1)");
    expect(stripSqlParams("no params here")).toBe("no params here");
  });

  it("replaces home directories so a path never names the person", () => {
    expect(scrubUserPaths("at /Users/steve/work/app/x.ts:1")).toBe(
      "at ~/work/app/x.ts:1",
    );
    expect(scrubUserPaths("/home/runner/work/x")).toBe("~/work/x");
    expect(scrubUserPaths("C:\\Users\\Ada\\proj\\x.ts")).toBe("~\\proj\\x.ts");
    expect(scrubUserPaths("/var/task/_chunks/a.mjs")).toBe(
      "/var/task/_chunks/a.mjs",
    );
  });

  it("strips ANSI colour codes", () => {
    expect(stripAnsi("\u001b[31merror\u001b[39m: bad")).toBe("error: bad");
  });
});
