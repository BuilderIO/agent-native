import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";
import { isProviderInteractiveScope } from "../provider-api/interactive-scope.js";
import {
  A2A_CALL_HOOK_TIMEOUT_MS,
  A2A_CALL_REFUSED_KIND,
  A2ACallHookError,
  A2ACallRefusedError,
  clearA2AActionCallHooksForTests,
  decideIncomingA2AActionCall,
  registerA2AActionCallHook,
  type A2AIncomingActionCall,
} from "./call-hooks.js";
import { callAction, clearA2ACardCache } from "./client.js";
import { runAsA2AForegroundCall } from "./foreground-call-scope.js";

vi.mock("../extensions/url-safety.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../extensions/url-safety.js")>();
  return {
    ...original,
    ssrfSafeFetch: (url: string, init?: RequestInit) => fetch(url, init),
  };
});

const originalEnv = { ...process.env };

function stubPeer(
  answer: (params: Record<string, unknown>) => Record<string, unknown>,
) {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const body = JSON.parse(String(init.body));
      sent.push(body.params);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, ...answer(body.params) }),
        { status: 200 },
      );
    }),
  );
  return sent;
}

const completed = () => ({
  result: { action: "read", status: "completed", output: "[]" },
});

beforeEach(() => {
  process.env = { ...originalEnv, A2A_SECRET: "synthetic-hook-secret" };
});
afterEach(() => {
  clearA2AActionCallHooksForTests();
  clearA2ACardCache();
  vi.unstubAllGlobals();
  process.env = originalEnv;
});

describe("outgoing A2A action call hooks", () => {
  it("sends exactly the action, input and metadata when no hook is registered", async () => {
    const sent = stubPeer(completed);
    await callAction(
      "https://peer.example.test",
      "read",
      { q: 1 },
      {
        userEmail: "alice@example.test",
      },
    );
    expect(sent).toEqual([{ action: "read", input: { q: 1 } }]);
  });

  it("adds a hook's params and tells the hook where the call goes", async () => {
    const outgoing = vi.fn(() => ({ params: { proof: { v: 1 } } }));
    registerA2AActionCallHook({ id: "proof", outgoing });
    const sent = stubPeer(completed);
    await callAction(
      "https://peer.example.test/",
      "read",
      { q: 1 },
      {
        userEmail: "alice@example.test",
        invocationTarget: {
          kind: "discovered",
          id: "peer",
          url: "https://peer.example.test/",
          source: "workspace",
        },
      },
    );
    expect(sent).toEqual([
      { proof: { v: 1 }, action: "read", input: { q: 1 } },
    ]);
    expect(outgoing).toHaveBeenCalledWith({
      url: "https://peer.example.test/",
      audience: "https://peer.example.test",
      action: "read",
      input: { q: 1 },
      userEmail: "alice@example.test",
      target: {
        kind: "discovered",
        id: "peer",
        url: "https://peer.example.test/",
        source: "workspace",
      },
    });
  });

  it("refuses to send a param that would replace the call's own", async () => {
    registerA2AActionCallHook({
      id: "clobber",
      outgoing: () => ({ params: { input: {} } }),
    });
    const sent = stubPeer(completed);
    await expect(
      callAction("https://peer.example.test", "read", {}, {}),
    ).rejects.toBeInstanceOf(A2ACallHookError);
    expect(sent).toEqual([]);
  });

  it("does not send the call when a hook throws", async () => {
    registerA2AActionCallHook({
      id: "broken",
      outgoing: () => {
        throw new Error("signing unavailable");
      },
    });
    const sent = stubPeer(completed);
    await expect(
      callAction("https://peer.example.test", "read", {}, {}),
    ).rejects.toMatchObject({ name: "A2ACallHookError", hookId: "broken" });
    expect(sent).toEqual([]);
  });

  it("does not send the call when a hook never answers", async () => {
    vi.useFakeTimers();
    try {
      registerA2AActionCallHook({
        id: "stuck",
        outgoing: () => new Promise<never>(() => {}),
      });
      const sent = stubPeer(completed);
      const pending = callAction(
        "https://peer.example.test",
        "read",
        {},
        {},
      ).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(A2A_CALL_HOOK_TIMEOUT_MS);
      expect(await pending).toMatchObject({
        name: "A2ACallHookError",
        hookId: "stuck",
      });
      expect(sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a peer hook's refusal as A2ACallRefusedError", async () => {
    stubPeer(() => ({
      error: {
        code: -32001,
        message: "Invalid proof",
        data: { kind: A2A_CALL_REFUSED_KIND, hookId: "gate", reason: "bad" },
      },
    }));
    const error = await callAction(
      "https://peer.example.test",
      "read",
      {},
      {},
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(A2ACallRefusedError);
    expect(error).toMatchObject({
      code: -32001,
      hookId: "gate",
      reason: "bad",
    });
  });

  it("keeps other peer errors as plain errors", async () => {
    stubPeer(() => ({ error: { code: -32001, message: "nope" } }));
    const error = await callAction(
      "https://peer.example.test",
      "read",
      {},
      {},
    ).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(A2ACallRefusedError);
    expect(String(error)).toContain("A2A error (-32001): nope");
  });
});

describe("incoming A2A action call decisions", () => {
  const call: A2AIncomingActionCall = {
    action: "read",
    input: {},
    params: {},
    caller: { email: "alice@example.test", audiences: [] },
    isOrgMember: async () => true,
  };

  it("has no opinion without hooks", async () => {
    await expect(decideIncomingA2AActionCall(call)).resolves.toBeUndefined();
  });

  it("fails a call whose incoming hook never answers", async () => {
    vi.useFakeTimers();
    try {
      registerA2AActionCallHook({
        id: "stuck",
        incoming: () => new Promise<never>(() => {}),
      });
      const pending = decideIncomingA2AActionCall(call).catch(
        (caught: unknown) => caught,
      );
      await vi.advanceTimersByTimeAsync(A2A_CALL_HOOK_TIMEOUT_MS);
      expect(await pending).toMatchObject({
        name: "A2ACallHookError",
        hookId: "stuck",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("combines admissions to the earliest expiry and stops at a refusal", async () => {
    registerA2AActionCallHook({
      id: "a",
      incoming: () => ({
        status: "admitted",
        foreground: { expiresAt: 2_000 },
      }),
    });
    registerA2AActionCallHook({
      id: "b",
      incoming: () => ({
        status: "admitted",
        foreground: { expiresAt: 1_000 },
      }),
    });
    await expect(decideIncomingA2AActionCall(call)).resolves.toEqual({
      status: "admitted",
      foreground: { expiresAt: 1_000 },
    });
    registerA2AActionCallHook({
      id: "c",
      incoming: () => ({ status: "refused", message: "no" }),
    });
    await expect(decideIncomingA2AActionCall(call)).resolves.toEqual({
      status: "refused",
      hookId: "c",
      message: "no",
    });
  });

  it("refuses when hooks name different organizations", async () => {
    registerA2AActionCallHook({
      id: "a",
      incoming: () => ({ status: "admitted", orgId: "org-a" }),
    });
    registerA2AActionCallHook({
      id: "b",
      incoming: () => ({ status: "admitted", orgId: "org-b" }),
    });
    await expect(decideIncomingA2AActionCall(call)).resolves.toMatchObject({
      status: "refused",
      reason: "org-conflict",
    });
  });

  it("rejects a second hook under a taken id", () => {
    registerA2AActionCallHook({ id: "same" });
    expect(() => registerA2AActionCallHook({ id: "same" })).toThrow(
      /already registered/,
    );
  });
});

describe("actions called over A2A", () => {
  const probe = defineAction({
    description: "Reports whether it runs as foreground work.",
    readOnly: true,
    run: async () => isProviderInteractiveScope(),
  });

  it("are not interactive by default", async () => {
    await expect(probe.run({}, { caller: "a2a" } as never)).resolves.toBe(
      false,
    );
  });

  it("are interactive inside an admitted foreground call", async () => {
    await expect(
      runAsA2AForegroundCall(Date.now() + 30_000, () =>
        probe.run({}, { caller: "a2a" } as never),
      ),
    ).resolves.toBe(true);
  });

  it("are not interactive once the admission expired", async () => {
    await expect(
      runAsA2AForegroundCall(Date.now() - 1, () =>
        probe.run({}, { caller: "a2a" } as never),
      ),
    ).resolves.toBe(false);
  });
});
