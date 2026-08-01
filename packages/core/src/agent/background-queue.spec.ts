import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyInternalToken } from "../integrations/internal-token.js";
import {
  AGENT_BACKGROUND_QUEUE_BINDING,
  agentBackgroundQueueName,
  BACKGROUND_QUEUE_MESSAGE_KIND,
  BACKGROUND_QUEUE_MESSAGE_MAX_BYTES,
  buildBackgroundQueueMessage,
  hasBoundBackgroundQueue,
  OversizedBackgroundQueueMessageError,
  resolveBackgroundQueueProducer,
  sendBackgroundQueueMessage,
} from "./background-queue.js";

/**
 * The producer half of the Cloudflare queue transport. The decisive cases are
 * the negative ones: an absent binding, a refused oversized payload, and a
 * rejected send must each surface as a distinct, thrown failure so the caller
 * degrades to an inline run instead of reporting a handoff that never happened.
 */

const ENV_KEYS = ["A2A_SECRET"] as const;

const ORIGIN = "https://app.example.com";

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
});

afterEach(() => {
  process.env = saved;
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "__cf_env");
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "__env__");
});

/** Bind a queue producer the way the generated Worker entry does. */
function bindQueue(send: (message: unknown) => Promise<void>) {
  (globalThis as Record<string, unknown>).__cf_env = {
    [AGENT_BACKGROUND_QUEUE_BINDING]: { send },
  };
}

describe("background queue binding resolution", () => {
  it("is unbound off the Cloudflare runtime", () => {
    expect(hasBoundBackgroundQueue()).toBe(false);
    expect(resolveBackgroundQueueProducer()).toBeNull();
  });

  it("is unbound on a Worker with no queue binding", () => {
    (globalThis as Record<string, unknown>).__cf_env = {};
    expect(hasBoundBackgroundQueue()).toBe(false);
  });

  it("resolves the producer from the platform env", () => {
    bindQueue(async () => {});
    expect(hasBoundBackgroundQueue()).toBe(true);
  });

  it("reads Nitro's own __env__ binding surface too", () => {
    (globalThis as Record<string, unknown>).__env__ = {
      [AGENT_BACKGROUND_QUEUE_BINDING]: { send: async () => {} },
    };
    expect(hasBoundBackgroundQueue()).toBe(true);
  });

  it("reports a binding that exists but cannot send, and stays unbound", () => {
    (globalThis as Record<string, unknown>).__cf_env = {
      [AGENT_BACKGROUND_QUEUE_BINDING]: { notAQueue: true },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(hasBoundBackgroundQueue()).toBe(false);
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  it("names one queue per Worker so two apps never share a consumer", () => {
    expect(agentBackgroundQueueName("design")).toBe("design-agent-background");
  });
});

describe("background queue envelope", () => {
  it("carries the signed internal token, not a raw secret", () => {
    process.env.A2A_SECRET = "test-secret-not-a-real-key";
    const message = buildBackgroundQueueMessage({
      taskId: "run_1",
      origin: ORIGIN,
      body: { __agentNativeProcessor: "a2a" },
    });

    expect(message.kind).toBe(BACKGROUND_QUEUE_MESSAGE_KIND);
    expect(message.authorization).toMatch(/^Bearer /);
    expect(message.authorization).not.toContain("test-secret-not-a-real-key");
    expect(
      verifyInternalToken("run_1", String(message.authorization).slice(7)),
    ).toBe(true);
    expect(message.body).toEqual({
      taskId: "run_1",
      __agentNativeProcessor: "a2a",
    });
  });

  it("sends unsigned only where the HTTP handoff also would (no A2A_SECRET)", () => {
    const message = buildBackgroundQueueMessage({
      taskId: "run_1",
      origin: ORIGIN,
    });
    expect(message.authorization).toBeNull();
  });

  it("carries the caller's origin for the synthesised request", () => {
    // Resolved by `fireBackgroundDispatch` through the same resolver the HTTP
    // transport uses, so both transports agree on which URL this deploy is.
    expect(
      buildBackgroundQueueMessage({ taskId: "run_1", origin: ORIGIN }).origin,
    ).toBe(ORIGIN);
  });
});

describe("sendBackgroundQueueMessage", () => {
  it("enqueues the envelope once the binding is present", async () => {
    const send = vi.fn(async () => {});
    bindQueue(send);

    await sendBackgroundQueueMessage({
      taskId: "run_1",
      origin: ORIGIN,
      body: { __backgroundRun: { runId: "run_1", payloadRef: true } },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      kind: BACKGROUND_QUEUE_MESSAGE_KIND,
      taskId: "run_1",
      body: { taskId: "run_1" },
    });
  });

  it("throws when nothing is bound rather than reporting a handoff", async () => {
    await expect(
      sendBackgroundQueueMessage({ taskId: "run_1", origin: ORIGIN }),
    ).rejects.toThrow(AGENT_BACKGROUND_QUEUE_BINDING);
  });

  it("propagates a rejected send so the caller degrades to an inline run", async () => {
    bindQueue(async () => {
      throw new Error("queue over quota");
    });

    await expect(
      sendBackgroundQueueMessage({ taskId: "run_1", origin: ORIGIN }),
    ).rejects.toThrow("queue over quota");
  });

  it("REFUSES an oversized inline body — never truncates it", async () => {
    const send = vi.fn(async () => {});
    bindQueue(send);
    // The normal path sends only a marker; this is the inline-body fallback,
    // used when the run row insert failed and the payload has nowhere else to
    // live. Too big for the transport means "run it inline", never "send less".
    const oversized = "x".repeat(BACKGROUND_QUEUE_MESSAGE_MAX_BYTES + 1);

    const failure = await sendBackgroundQueueMessage({
      taskId: "run_1",
      origin: ORIGIN,
      body: { message: oversized },
    }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(OversizedBackgroundQueueMessageError);
    expect(
      (failure as OversizedBackgroundQueueMessageError).byteLength,
    ).toBeGreaterThan(BACKGROUND_QUEUE_MESSAGE_MAX_BYTES);
    expect(send).not.toHaveBeenCalled();
  });

  it("still enqueues a payload that fits", async () => {
    const send = vi.fn(async () => {});
    bindQueue(send);

    await sendBackgroundQueueMessage({
      taskId: "run_1",
      origin: ORIGIN,
      body: { message: "y".repeat(1024) },
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
