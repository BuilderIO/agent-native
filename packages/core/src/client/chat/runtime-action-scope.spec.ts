import { AgentKitClient } from "@agent-native/agentkit/client";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_ACTION_SCOPE_MAX_BYTES,
  type AgentActionScope,
} from "../../agent/types.js";
import {
  createAgentNativeAgentKitTransport,
  type CreateAgentNativeAgentKitTransportOptions,
} from "./agentkit-agent-native.js";
import {
  createAgentNativeChatRuntime,
  type AgentChatRuntime,
  type AgentChatRuntimeKnownEvent,
  type CreateAgentNativeChatRuntimeOptions,
} from "./runtime.js";

const API_URL = "/_agent-native/agent-chat";

/**
 * The contract adds `actionScope` to the runtime options before the type ships.
 * The intersection keeps these cases usable while the option is still untyped,
 * and collapses to the real `AgentActionScope` once it lands.
 */
type RuntimeOptionsWithActionScope = CreateAgentNativeChatRuntimeOptions & {
  readonly actionScope?: unknown;
};

type TransportOptionsWithActionScope =
  CreateAgentNativeAgentKitTransportOptions & {
    readonly actionScope?: unknown;
  };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseDone(runId: string): Response {
  return new Response(
    `data: ${JSON.stringify({ type: "done", reason: "complete" })}\n\n`,
    {
      headers: {
        "content-type": "text/event-stream",
        "x-run-id": runId,
      },
    },
  );
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

function createRuntime(
  options: RuntimeOptionsWithActionScope & { readonly fetch: typeof fetch },
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  const fetchImpl = options.fetch;
  const wrapped: RuntimeOptionsWithActionScope = {
    ...options,
    fetch: async (input, init) =>
      String(input).includes("/agent-engine/status")
        ? json({ configured: true, chatEligible: true })
        : fetchImpl(input, init),
  };
  return createAgentNativeChatRuntime(
    wrapped as CreateAgentNativeChatRuntimeOptions,
  );
}

function createTransport(
  options: TransportOptionsWithActionScope & { readonly fetch: typeof fetch },
) {
  const fetchImpl = options.fetch;
  const wrapped: TransportOptionsWithActionScope = {
    ...options,
    fetch: async (input, init) =>
      String(input).includes("/agent-engine/status")
        ? json({ configured: true, chatEligible: true })
        : fetchImpl(input, init),
  };
  return createAgentNativeAgentKitTransport(
    wrapped as CreateAgentNativeAgentKitTransportOptions,
  );
}

function postedBody(
  fetchMock: { mock: { calls: readonly unknown[][] } },
  url = API_URL,
): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === url &&
      ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() ===
        "POST",
  );
  if (!call) throw new Error(`No POST body captured for ${url}`);
  return JSON.parse(
    String((call[1] as RequestInit | undefined)?.body),
  ) as Record<string, unknown>;
}

describe("createAgentNativeChatRuntime actionScope", () => {
  it("sends a normalized top-level actionScope on the initial request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseDone("run-scope-initial"));
    const scope: AgentActionScope = {
      runId: "run-review",
      surface: { kind: "observability-review-summary", pinned: true },
      tags: ["alpha", null, 2],
    };
    const runtime = createRuntime({
      apiUrl: API_URL,
      fetch: fetchMock as typeof fetch,
      actionScope: scope,
    });

    const session = await runtime.createSession({
      threadId: "thread-scope-initial",
    });
    await drain(
      (await session.startTurn({ prompt: "Summarize the run." })).events,
    );

    const body = postedBody(fetchMock);
    expect(Object.hasOwn(body, "actionScope")).toBe(true);
    expect(body.actionScope).toEqual(scope);
  });

  it("detaches the actionScope snapshot at creation so later caller mutation cannot retarget it", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseDone("run-scope-snapshot"));
    const scope = { runId: "original-run", nested: { mode: "review" } };
    const runtime = createRuntime({
      apiUrl: API_URL,
      fetch: fetchMock as typeof fetch,
      actionScope: scope,
    });

    scope.runId = "mutated-run";
    scope.nested.mode = "mutated";
    (scope as Record<string, unknown>).added = "later";

    const session = await runtime.createSession({
      threadId: "thread-scope-snapshot",
    });
    await drain(
      (await session.startTurn({ prompt: "Keep the original scope." })).events,
    );

    expect(postedBody(fetchMock).actionScope).toEqual({
      runId: "original-run",
      nested: { mode: "review" },
    });
  });

  it("omits the top-level actionScope when no option is given and never lifts metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseDone("run-scope-absent"));
    const runtime = createRuntime({
      apiUrl: API_URL,
      fetch: fetchMock as typeof fetch,
    });

    const session = await runtime.createSession({
      threadId: "thread-scope-absent",
    });
    await drain(
      (
        await session.startTurn({
          prompt: "No scope was configured.",
          metadata: { actionScope: { injected: true } },
        })
      ).events,
    );

    const body = postedBody(fetchMock);
    expect(Object.hasOwn(body, "actionScope")).toBe(false);
    expect(body.metadata).toEqual({ actionScope: { injected: true } });
  });

  it("rejects invalid action scopes at runtime creation before any fetch", () => {
    const cases: Array<{ label: string; scope: AgentActionScope }> = [
      { label: "NaN", scope: { threshold: Number.NaN } },
      {
        label: "function",
        scope: { run: () => "x" } as unknown as AgentActionScope,
      },
      { label: "array", scope: [] as unknown as AgentActionScope },
      {
        label: "oversize",
        scope: { blob: "x".repeat(AGENT_ACTION_SCOPE_MAX_BYTES + 1) },
      },
    ];

    for (const { label, scope } of cases) {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => sseDone("run-scope-invalid"));
      expect(
        () =>
          createRuntime({
            apiUrl: API_URL,
            fetch: fetchMock as typeof fetch,
            actionScope: scope,
          }),
        label,
      ).toThrow(TypeError);
      expect(fetchMock, label).not.toHaveBeenCalled();
    }
  });

  it("carries the configured actionScope onto a continued request and resists metadata overrides", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseDone("run-scope-continuation-1"))
      .mockResolvedValueOnce(sseDone("run-scope-continuation-2"));
    const scope: AgentActionScope = { runId: "run-1", kind: "review" };
    const runtime = createRuntime({
      apiUrl: API_URL,
      fetch: fetchMock as typeof fetch,
      actionScope: scope,
    });

    const session = await runtime.createSession({
      threadId: "thread-scope-continuation",
    });
    const first = await session.startTurn({ prompt: "First." });
    await drain(first.events);

    const continuation = await session.continueTurn?.({
      turnId: first.id,
      prompt: "Continue.",
      metadata: { actionScope: { hijack: true } },
    });
    expect(continuation).toBeDefined();
    await drain(continuation!.events);

    const initialBody = postedBody(fetchMock);
    expect(initialBody.actionScope).toEqual(scope);

    const continuationCall = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input) === API_URL &&
        ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() ===
          "POST",
    );
    expect(continuationCall).toHaveLength(2);
    const continuedBody = JSON.parse(
      String((continuationCall[1]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(continuedBody.actionScope).toEqual(scope);
    expect(continuedBody.metadata).toMatchObject({
      actionScope: { hijack: true },
    });
  });
});

describe("createAgentNativeAgentKitTransport actionScope forwarding", () => {
  it("forwards the actionScope option through the AgentKit transport on the initial request", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/agent-engine/status")) {
          return json({ configured: true, chatEligible: true });
        }
        if (url === API_URL && method === "POST") {
          return sseDone("run-transport-scope");
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const scope: AgentActionScope = {
      runId: "transport-run",
      kind: "review",
    };
    const transport = createTransport({
      apiUrl: API_URL,
      fetch: fetcher as typeof fetch,
      actionScope: scope,
      persistThreadSnapshots: false,
    });
    const client = new AgentKitClient({ transport });

    try {
      const run = await client.sendMessage({
        threadId: "thread-transport-scope",
        text: "Scoped message.",
      });
      await run.completed;
    } finally {
      await client.shutdown();
    }

    expect(postedBody(fetcher).actionScope).toEqual(scope);
  });

  it("omits the actionScope key through the AgentKit transport when the option is absent", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/agent-engine/status")) {
          return json({ configured: true, chatEligible: true });
        }
        if (url === API_URL && method === "POST") {
          return sseDone("run-transport-plain");
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createTransport({
      apiUrl: API_URL,
      fetch: fetcher as typeof fetch,
      persistThreadSnapshots: false,
    });
    const client = new AgentKitClient({ transport });

    try {
      const run = await client.sendMessage({
        threadId: "thread-transport-plain",
        text: "Unscoped message.",
      });
      await run.completed;
    } finally {
      await client.shutdown();
    }

    expect(Object.hasOwn(postedBody(fetcher), "actionScope")).toBe(false);
  });

  it("rejects an invalid actionScope through the AgentKit transport before any request", () => {
    const fetcher = vi.fn(async () =>
      json({ configured: true, chatEligible: true }),
    );

    expect(() =>
      createTransport({
        apiUrl: API_URL,
        fetch: fetcher as typeof fetch,
        actionScope: [] as unknown as AgentActionScope,
      }),
    ).toThrow(TypeError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
