import { afterEach, describe, expect, it } from "vitest";

import { generateWorkerEntry } from "../deploy/build.js";
import { __hostedRealtimeTransportEnabledForTests } from "./poll.js";
import { resolveRealtimeClientConfig } from "./sentry-config.js";

const ENV_KEYS = [
  "AGENT_NATIVE_REALTIME_TRANSPORT",
  "AGENT_NATIVE_REALTIME_GATEWAY_URL",
  "BUILDER_GATEWAY_BASE_URL",
] as const;

const DEFAULT_GATEWAY =
  "https://api.builder.io/agent-native/gateway/v1/realtime";

function evaluateWorkerGate(env: Record<string, string | undefined>) {
  const source = generateWorkerEntry([], []);
  const start = source.indexOf("function firstNonEmpty()");
  const realtimeStart = source.indexOf(
    "function getRealtimeClientConfigScript()",
  );
  const realtimeEnd = source.indexOf("\nfunction ", realtimeStart + 1);
  expect(start).toBeGreaterThan(-1);
  expect(realtimeStart).toBeGreaterThan(-1);
  const firstNonEmptyEnd = source.indexOf("\nfunction ", start + 1);
  const fn = new Function(
    "processEnv",
    `${source.slice(start, firstNonEmptyEnd)}
     const globalThis_ = { process: { env: processEnv } };
     ${source
       .slice(realtimeStart, realtimeEnd)
       .replace("globalThis?.process?.env", "globalThis_.process.env")
       .replace("globalThis.process?.env", "globalThis_.process.env")}
     return getRealtimeClientConfigScript();`,
  );
  const script = fn(env) as string | null;
  if (!script) return null;
  const marker = "window.__AGENT_NATIVE_CONFIG__,";
  const json = script.slice(
    script.lastIndexOf(marker) + marker.length,
    script.lastIndexOf(");</script>"),
  );
  return JSON.parse(json).realtime as {
    transport: string;
    gatewayBaseUrl: string;
  };
}

const saved = new Map<string, string | undefined>();

function withEnv(env: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

const CASES: Array<{
  name: string;
  env: Record<string, string | undefined>;
  hosted: boolean;
  gatewayBaseUrl?: string;
}> = [
  {
    name: "nothing set — local",
    env: {},
    hosted: false,
  },
  {
    name: "transport alone is now enough, and derives the prod gateway",
    env: { AGENT_NATIVE_REALTIME_TRANSPORT: "hosted" },
    hosted: true,
    gatewayBaseUrl: DEFAULT_GATEWAY,
  },
  {
    name: "an explicit gateway URL still wins",
    env: {
      AGENT_NATIVE_REALTIME_TRANSPORT: "hosted",
      AGENT_NATIVE_REALTIME_GATEWAY_URL: "https://qa.example/rt",
    },
    hosted: true,
    gatewayBaseUrl: "https://qa.example/rt",
  },
  {
    name: "a staging Builder gateway base redirects realtime with it",
    env: {
      AGENT_NATIVE_REALTIME_TRANSPORT: "hosted",
      BUILDER_GATEWAY_BASE_URL:
        "https://staging.example/agent-native/gateway/v1",
    },
    hosted: true,
    gatewayBaseUrl: "https://staging.example/agent-native/gateway/v1/realtime",
  },
  {
    name: "a trailing slash on the base does not produce a double slash",
    env: {
      AGENT_NATIVE_REALTIME_TRANSPORT: "hosted",
      BUILDER_GATEWAY_BASE_URL: "https://staging.example/gateway/v1/",
    },
    hosted: true,
    gatewayBaseUrl: "https://staging.example/gateway/v1/realtime",
  },
  {
    name: "a gateway URL without hosted transport stays local",
    env: { AGENT_NATIVE_REALTIME_GATEWAY_URL: "https://qa.example/rt" },
    hosted: false,
  },
  {
    name: "an unrecognized transport stays local",
    env: { AGENT_NATIVE_REALTIME_TRANSPORT: "local" },
    hosted: false,
  },
  {
    name: "whitespace is trimmed, not treated as a value",
    env: { AGENT_NATIVE_REALTIME_TRANSPORT: "  hosted  " },
    hosted: true,
    gatewayBaseUrl: DEFAULT_GATEWAY,
  },
];

describe("hosted realtime transport gate", () => {
  it.each(CASES)("$name", ({ env, hosted, gatewayBaseUrl }) => {
    withEnv(env);

    const ssr = resolveRealtimeClientConfig();
    const worker = evaluateWorkerGate(process.env);
    const poll = __hostedRealtimeTransportEnabledForTests();

    expect({
      ssr: ssr !== null,
      worker: worker !== null,
      poll,
    }).toEqual({ ssr: hosted, worker: hosted, poll: hosted });

    if (hosted) {
      expect(ssr?.gatewayBaseUrl).toBe(gatewayBaseUrl);
      expect(worker?.gatewayBaseUrl).toBe(gatewayBaseUrl);
    }
  });
});
