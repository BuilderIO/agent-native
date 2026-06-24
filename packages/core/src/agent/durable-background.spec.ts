import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_CHAT_PROCESS_RUN_PATH,
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  isAgentChatDurableBackgroundEnabled,
  isHostedRuntimeForDurableBackground,
} from "./durable-background.js";

/**
 * The single gate that decides whether a long agent-chat turn is routed through
 * the server-driven background worker. Phase-1 GUARDRAIL: this must be false
 * (→ unchanged synchronous path) unless ALL of {flag truthy, hosted runtime,
 * A2A_SECRET set} hold. These tests pin every leg of that AND.
 */

// Env keys the gate reads, snapshotted/cleared so each case is isolated.
const ENV_KEYS = [
  "AGENT_CHAT_DURABLE_BACKGROUND",
  "A2A_SECRET",
  "NETLIFY",
  "NETLIFY_LOCAL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "CF_PAGES",
  "VERCEL",
  "VERCEL_ENV",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Mark the runtime as hosted (Netlify, not local). */
function makeHosted() {
  process.env.NETLIFY = "true";
}

describe("durable-background constants", () => {
  it("exposes the process-run route + marker field used by both sides", () => {
    expect(AGENT_CHAT_PROCESS_RUN_PATH).toBe(
      "/_agent-native/agent-chat/_process-run",
    );
    expect(AGENT_CHAT_BACKGROUND_RUN_FIELD).toBe("__backgroundRun");
  });
});

describe("isAgentChatDurableBackgroundEnabled (Phase-1 gate)", () => {
  it("is OFF by default (no flag, not hosted, no secret)", () => {
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("is OFF when the flag is unset even if hosted + secret are present", () => {
    makeHosted();
    process.env.A2A_SECRET = "shhh";
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("is OFF when the flag is a non-truthy value", () => {
    makeHosted();
    process.env.A2A_SECRET = "shhh";
    for (const val of ["0", "false", "no", "off", "", "maybe"]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = val;
      expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
    }
  });

  it("is OFF when the flag is on + secret set but NOT hosted (local dev)", () => {
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
    process.env.A2A_SECRET = "shhh";
    // No hosted env var set.
    expect(isHostedRuntimeForDurableBackground()).toBe(false);
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("is OFF when the flag is on + hosted but A2A_SECRET is missing", () => {
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
    makeHosted();
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("treats NETLIFY_LOCAL=true as NOT hosted (netlify dev)", () => {
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "1";
    process.env.A2A_SECRET = "shhh";
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";
    expect(isHostedRuntimeForDurableBackground()).toBe(false);
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("is ON only when flag truthy AND hosted AND A2A_SECRET set", () => {
    process.env.A2A_SECRET = "shhh";
    makeHosted();
    for (const val of ["1", "true", "yes", "on", " TRUE "]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = val;
      expect(isAgentChatDurableBackgroundEnabled()).toBe(true);
    }
  });
});
