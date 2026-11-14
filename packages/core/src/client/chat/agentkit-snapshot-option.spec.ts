import { AgentKitClient } from "@agent-native/agentkit/client";
import { AGENT_NATIVE_SUBMISSION_DEADLINES_CAPABILITY_ID } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentNativeAgentKitTransport as createAgentNativeAgentKitTransportImplementation } from "./agentkit-agent-native.js";
import { createAgentNativeChatRuntime } from "./runtime.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Mirrors the transport-time test harness: readiness and capability probes are
// answered locally so every request in these cases is synthetic.
function createAgentNativeAgentKitTransport(
  options: Parameters<
    typeof createAgentNativeAgentKitTransportImplementation
  >[0],
) {
  const fetchImpl = options.fetch ?? fetch;
  return createAgentNativeAgentKitTransportImplementation({
    ...options,
    fetch: (async (input, init) => {
      const url = String(input);
      if (url.includes("/_agent-native/agent-engine/status")) {
        return json({ configured: true, chatEligible: true });
      }
      if (url.endsWith("/_agent-native/agent-chat/capabilities")) {
        return json({
          [AGENT_NATIVE_SUBMISSION_DEADLINES_CAPABILITY_ID]: true,
        });
      }
      return fetchImpl(input, init);
    }) as typeof fetch,
  });
}

function snapshot(threadId: string) {
  return {
    id: threadId,
    title: "Snapshot option",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:01.000Z",
    messages: [],
  };
}

// Streams the assistant answer first and finishes later, so the client holds a
// readable live message before terminal hydration replaces the projection.
function streamingRunResponse(runId: string, canary: string) {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "text", text: canary, seq: 1 })}\n\n`,
        ),
      );
    },
  });
  return {
    response: new Response(body, {
      headers: { "content-type": "text/event-stream", "x-run-id": runId },
    }),
    finish() {
      if (finished) return;
      finished = true;
      streamController.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "done", seq: 2 })}\n\n`),
      );
      streamController.close();
    },
  };
}

describe("createAgentNativeAgentKitTransport thread snapshot option", () => {
  it.each([
    ["default", undefined],
    ["explicit true", true],
  ])("installs and honors the snapshot writer for %s", async (_label, flag) => {
    const threadId = "thread-snapshot-enabled";
    const writer = vi.fn(async (_input: unknown) => undefined);
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: vi.fn(async () =>
        json({ error: "Not found" }, 404),
      ) as typeof fetch,
      ...(flag === undefined ? {} : { persistThreadSnapshots: flag }),
      operations: { persistThreadSnapshot: writer },
    });

    expect(typeof transport.persistThreadSnapshot).toBe("function");
    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: snapshot(threadId),
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[0]).toMatchObject({ threadId });
    await transport.dispose();
  });

  it("omits the snapshot operation and performs no write when disabled", async () => {
    const apiUrl = "https://provider.example.test/_agent-native/agent-chat";
    const threadId = "thread-snapshot-disabled";
    const runId = "run-snapshot-disabled";
    const canary = "synthetic-live-output-canary";
    const writer = vi.fn(async (_input: unknown) => undefined);
    const stream = streamingRunResponse(runId, canary);
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/_agent-native/agent-engine/status")) {
          return json({ configured: true, chatEligible: true });
        }
        if (url === apiUrl && method === "POST") {
          return stream.response;
        }
        return json({ error: "Not found" }, 404);
      },
    );

    // The option lives on an inferred object so the case runs before the
    // option is added to the public type; vitest strips types at runtime.
    const options = {
      apiUrl,
      fetch: fetcher as typeof fetch,
      runtime: createAgentNativeChatRuntime({
        apiUrl,
        fetch: fetcher as typeof fetch,
      }),
      persistThreadSnapshots: false,
      operations: { persistThreadSnapshot: writer },
    };
    const transport = createAgentNativeAgentKitTransport(options);

    expect(Object.hasOwn(transport, "persistThreadSnapshot")).toBe(false);

    const client = new AgentKitClient({ transport });
    try {
      const run = await client.sendMessage({
        threadId,
        text: "Produce a private live answer.",
      });

      let liveReadable = false;
      for (let attempt = 0; attempt < 100 && !liveReadable; attempt += 1) {
        liveReadable = JSON.stringify(
          client.getThread(threadId).messages,
        ).includes(canary);
        if (!liveReadable) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      expect(liveReadable).toBe(true);

      stream.finish();
      await run.completed;

      expect(
        await client.persistThreadSnapshotWithResult(threadId),
      ).toBeUndefined();
      expect(writer).not.toHaveBeenCalled();

      const putCalls = fetcher.mock.calls.filter(
        ([, init]) => (init?.method ?? "GET").toUpperCase() === "PUT",
      );
      expect(putCalls).toHaveLength(0);
      for (const [, init] of fetcher.mock.calls) {
        if (init?.body) {
          expect(String(init.body)).not.toContain(canary);
        }
      }
    } finally {
      stream.finish();
      await client.shutdown();
    }
  });

  it("omits the internal snapshot writer when nothing is supplied and disabled", async () => {
    const apiUrl = "https://provider.example.test/_agent-native/agent-chat";
    const threadId = "thread-snapshot-disabled-internal";
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/_agent-native/agent-engine/status")) {
          return json({ configured: true, chatEligible: true });
        }
        if (url === apiUrl && method === "POST") {
          return new Response(
            `data: ${JSON.stringify({ type: "done", seq: 1 })}\n\n`,
            {
              headers: {
                "content-type": "text/event-stream",
                "x-run-id": "run-snapshot-disabled-internal",
              },
            },
          );
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const options = {
      apiUrl,
      fetch: fetcher as typeof fetch,
      runtime: createAgentNativeChatRuntime({
        apiUrl,
        fetch: fetcher as typeof fetch,
      }),
      persistThreadSnapshots: false,
    };
    const transport = createAgentNativeAgentKitTransport(options);

    expect(Object.hasOwn(transport, "persistThreadSnapshot")).toBe(false);

    const client = new AgentKitClient({ transport });
    try {
      const run = await client.sendMessage({ threadId, text: "No write." });
      await run.completed;
      expect(
        await client.persistThreadSnapshotWithResult(threadId),
      ).toBeUndefined();
      expect(
        fetcher.mock.calls.some(
          ([, init]) => (init?.method ?? "GET").toUpperCase() === "PUT",
        ),
      ).toBe(false);
    } finally {
      await client.shutdown();
    }
  });
});
