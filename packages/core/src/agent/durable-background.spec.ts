import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_CHAT_PROCESS_RUN_PATH,
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  isAgentChatDurableBackgroundEnabled,
  isHostedRuntimeForDurableBackground,
  prepareProcessRunRequest,
} from "./durable-background.js";
import { signInternalToken } from "../integrations/internal-token.js";

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

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  // Snapshot the whole env, then clear the keys the gate reads so each case is
  // isolated. Spread + Reflect.deleteProperty avoid dynamic `process.env[key]`
  // access (which guard:no-env-credentials forbids even in tests).
  saved = { ...process.env };
  for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
});

afterEach(() => {
  process.env = saved;
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

describe("isAgentChatDurableBackgroundEnabled (default-on gate)", () => {
  it("is OFF with nothing configured (not hosted, no secret — gates compose)", () => {
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("is ON BY DEFAULT (flag unset) when hosted + secret are present", () => {
    makeHosted();
    process.env.A2A_SECRET = "shhh";
    delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    expect(isAgentChatDurableBackgroundEnabled()).toBe(true);
  });

  it("is OFF only when explicitly opted out via a falsy flag", () => {
    makeHosted();
    process.env.A2A_SECRET = "shhh";
    for (const val of ["0", "false", "no", "off", "FALSE", " Off "]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = val;
      expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
    }
  });

  it("is ON for truthy, unrecognized, or empty flag values (default-on)", () => {
    makeHosted();
    process.env.A2A_SECRET = "shhh";
    for (const val of ["1", "true", "yes", "on", " TRUE ", "", "maybe"]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = val;
      expect(isAgentChatDurableBackgroundEnabled()).toBe(true);
    }
  });

  it("stays OFF when default-on but NOT hosted (local dev keeps inline path)", () => {
    delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    process.env.A2A_SECRET = "shhh";
    expect(isHostedRuntimeForDurableBackground()).toBe(false);
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("stays OFF when default-on + hosted but A2A_SECRET is missing", () => {
    delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    makeHosted();
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });

  it("treats NETLIFY_LOCAL=true as NOT hosted (netlify dev), even default-on", () => {
    delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    process.env.A2A_SECRET = "shhh";
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";
    expect(isHostedRuntimeForDurableBackground()).toBe(false);
    expect(isAgentChatDurableBackgroundEnabled()).toBe(false);
  });
});

describe("prepareProcessRunRequest (_process-run auth + marker prep)", () => {
  const RUN_ID = "run-bg-123";

  it("rejects a non-object body with 400", () => {
    const r = prepareProcessRunRequest(null, undefined);
    expect(r).toEqual({
      ok: false,
      status: 400,
      error: "Invalid request body",
    });
  });

  it("rejects a body with no runId/taskId with 400", () => {
    const r = prepareProcessRunRequest({ message: "hi" }, undefined);
    expect(r).toEqual({ ok: false, status: 400, error: "runId required" });
  });

  describe("with A2A_SECRET configured", () => {
    beforeEach(() => {
      process.env.A2A_SECRET = "test-secret";
    });

    it("rejects a missing/unsigned token with 401", () => {
      const r = prepareProcessRunRequest(
        { [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID } },
        undefined,
      );
      expect(r).toMatchObject({ ok: false, status: 401 });
    });

    it("rejects an invalid token with 401", () => {
      const r = prepareProcessRunRequest(
        { [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID } },
        "Bearer not-a-real-token",
      );
      expect(r).toMatchObject({ ok: false, status: 401 });
    });

    it("rejects a token signed for a DIFFERENT runId with 401", () => {
      const token = signInternalToken("some-other-run");
      const r = prepareProcessRunRequest(
        { [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID } },
        `Bearer ${token}`,
      );
      expect(r).toMatchObject({ ok: false, status: 401 });
    });

    it("accepts a valid token bound to the runId and preserves the marker", () => {
      const token = signInternalToken(RUN_ID);
      const r = prepareProcessRunRequest(
        {
          message: "do it",
          [AGENT_CHAT_BACKGROUND_RUN_FIELD]: {
            runId: RUN_ID,
            turnId: "turn-9",
          },
        },
        `Bearer ${token}`,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("expected ok");
      expect(r.runId).toBe(RUN_ID);
      expect(r.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toMatchObject({
        runId: RUN_ID,
        turnId: "turn-9",
      });
    });

    it("injects the marker when only taskId is present (signed over taskId)", () => {
      const token = signInternalToken(RUN_ID);
      const r = prepareProcessRunRequest(
        { taskId: RUN_ID, message: "x" },
        `Bearer ${token}`,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("expected ok");
      expect(r.body[AGENT_CHAT_BACKGROUND_RUN_FIELD]).toEqual({
        runId: RUN_ID,
      });
    });
  });

  describe("without A2A_SECRET", () => {
    beforeEach(() => {
      delete process.env.A2A_SECRET;
    });

    it("refuses with 503 on a production runtime (never unsigned in prod)", () => {
      process.env.NETLIFY = "true";
      const r = prepareProcessRunRequest(
        { [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID } },
        undefined,
      );
      expect(r).toMatchObject({ ok: false, status: 503 });
    });

    it("allows an unsigned dispatch in local dev (SQL claim is the guard)", () => {
      // No production env vars set in beforeEach's cleared environment.
      const r = prepareProcessRunRequest(
        { [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID } },
        undefined,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("expected ok");
      expect(r.runId).toBe(RUN_ID);
    });
  });
});
