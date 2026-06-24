import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_BACKGROUND_FUNCTION_NAME,
  AGENT_BACKGROUND_FUNCTION_URL_PATH,
  AGENT_CHAT_PROCESS_RUN_PATH,
  AGENT_CHAT_BACKGROUND_RUN_FIELD,
  extractProcessRunId,
  isAgentChatDurableBackgroundEnabled,
  isHostedRuntimeForDurableBackground,
  isInBackgroundFunctionRuntime,
  prepareProcessRunRequest,
  resolveAgentChatProcessRunDispatchPath,
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
  "AGENT_CHAT_FORCE_BACKGROUND_RUNTIME",
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
  "AGENT_NATIVE_WORKSPACE_APP_ID",
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

describe("isInBackgroundFunctionRuntime (real -background function guard)", () => {
  it("is false with nothing set (a plain synchronous function)", () => {
    expect(isInBackgroundFunctionRuntime()).toBe(false);
  });

  it("is false for a normal synchronous Netlify/Lambda function name", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
    expect(isInBackgroundFunctionRuntime()).toBe(false);
    process.env.AWS_LAMBDA_FUNCTION_NAME = "plan-server";
    expect(isInBackgroundFunctionRuntime()).toBe(false);
  });

  it("is TRUE when the Lambda function name ends in -background (15-min budget)", () => {
    // Matches the emitted names: "server-agent-background" (single template)
    // and "<app>-agent-background" (workspace deploy).
    for (const name of [
      "server-agent-background",
      "plan-agent-background",
      "SERVER-AGENT-BACKGROUND",
    ]) {
      process.env.AWS_LAMBDA_FUNCTION_NAME = name;
      expect(isInBackgroundFunctionRuntime()).toBe(true);
    }
  });

  it("honors an explicit AGENT_CHAT_FORCE_BACKGROUND_RUNTIME override", () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    for (const v of ["1", "true", "yes", "on", " TRUE "]) {
      process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME = v;
      expect(isInBackgroundFunctionRuntime()).toBe(true);
    }
    for (const v of ["0", "false", "no", "off", ""]) {
      process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME = v;
      expect(isInBackgroundFunctionRuntime()).toBe(false);
    }
  });
});

describe("resolveAgentChatProcessRunDispatchPath (default function url on hosted Netlify)", () => {
  it("exposes the background function name + its default function url constant", () => {
    expect(AGENT_BACKGROUND_FUNCTION_NAME).toBe("server-agent-background");
    expect(AGENT_BACKGROUND_FUNCTION_URL_PATH).toBe(
      "/.netlify/functions/server-agent-background",
    );
    // Name MUST end in -background (Netlify async convention + runtime guard).
    expect(AGENT_BACKGROUND_FUNCTION_NAME.endsWith("-background")).toBe(true);
  });

  it("dispatches to the function's DEFAULT url on hosted Netlify (single template)", () => {
    // DOC-CORRECT: the background function declares NO custom config.path, so it
    // keeps its default url /.netlify/functions/<name>. The `server` /* catch-all
    // already excludes /.netlify/*, so a POST to that default url matches ONLY the
    // async function (202, 15-min) — it is never shadowed by the sync function.
    process.env.NETLIFY = "true";
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      AGENT_BACKGROUND_FUNCTION_URL_PATH,
    );
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      "/.netlify/functions/server-agent-background",
    );
  });

  it("dispatches to the PER-APP default url on hosted Netlify (workspace)", () => {
    // Workspace deploy emits one background fn per app named <app>-agent-background
    // reachable at its default url. The foreground reads the workspace app id from
    // AGENT_NATIVE_WORKSPACE_APP_ID and resolves the matching function url.
    process.env.NETLIFY = "true";
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID = "plan";
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      "/.netlify/functions/plan-agent-background",
    );
    Reflect.deleteProperty(process.env, "AGENT_NATIVE_WORKSPACE_APP_ID");
  });

  it("falls back to the single-template default url for an unsafe workspace app id", () => {
    process.env.NETLIFY = "true";
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID = "../evil";
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      AGENT_BACKGROUND_FUNCTION_URL_PATH,
    );
    Reflect.deleteProperty(process.env, "AGENT_NATIVE_WORKSPACE_APP_ID");
  });

  it("returns the framework process-run path when NOT on Netlify", () => {
    // Nothing set → not Netlify (e.g. local dev, Vercel, Cloudflare, self-host).
    // No second function exists; the in-process catch-all handles the route.
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      AGENT_CHAT_PROCESS_RUN_PATH,
    );
  });

  it("returns the framework path under `netlify dev` (NETLIFY_LOCAL=true)", () => {
    // `netlify dev` runs in-process; the same in-process catch-all handles it.
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      AGENT_CHAT_PROCESS_RUN_PATH,
    );
  });

  it("returns the framework path when NETLIFY is explicitly false", () => {
    process.env.NETLIFY = "false";
    expect(resolveAgentChatProcessRunDispatchPath()).toBe(
      AGENT_CHAT_PROCESS_RUN_PATH,
    );
  });
});

describe("prepareProcessRunRequest (_process-run auth + marker prep)", () => {
  const RUN_ID = "run-bg-123";

  it("rejects a non-object body with 400 (no runId to attach diagnostics to)", () => {
    const r = prepareProcessRunRequest(null, undefined);
    expect(r).toEqual({
      ok: false,
      status: 400,
      error: "Invalid request body",
      runId: null,
    });
  });

  it("rejects a body with no runId/taskId with 400", () => {
    const r = prepareProcessRunRequest({ message: "hi" }, undefined);
    expect(r).toEqual({
      ok: false,
      status: 400,
      error: "runId required",
      runId: null,
    });
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

    it("carries the runId on a 401 so the route can record the auth failure", () => {
      // DIAGNOSTIC: an auth failure in the unreadable bg fn must still be
      // attributable to a run so /runs/active can show WHY it timed out.
      const r = prepareProcessRunRequest(
        { [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID } },
        "Bearer bogus",
      );
      expect(r).toMatchObject({ ok: false, status: 401, runId: RUN_ID });
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
      // Carries the runId so the route can record the "A2A_SECRET missing"
      // failure onto the run (otherwise it would time out with no clue).
      expect(r).toMatchObject({ ok: false, status: 503, runId: RUN_ID });
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

describe("extractProcessRunId (diagnostic runId parse without auth)", () => {
  const RUN_ID = "run-diag-1";

  it("reads runId from the background-run marker", () => {
    expect(
      extractProcessRunId({
        [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID },
      }),
    ).toBe(RUN_ID);
  });

  it("falls back to top-level taskId", () => {
    expect(extractProcessRunId({ taskId: RUN_ID })).toBe(RUN_ID);
  });

  it("prefers the marker runId over taskId", () => {
    expect(
      extractProcessRunId({
        taskId: "other",
        [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: RUN_ID },
      }),
    ).toBe(RUN_ID);
  });

  it("returns null for an unparseable / empty body (no auth performed)", () => {
    expect(extractProcessRunId(null)).toBeNull();
    expect(extractProcessRunId("nope")).toBeNull();
    expect(extractProcessRunId({})).toBeNull();
    expect(extractProcessRunId({ taskId: "" })).toBeNull();
    expect(
      extractProcessRunId({ [AGENT_CHAT_BACKGROUND_RUN_FIELD]: { runId: 5 } }),
    ).toBeNull();
  });
});
