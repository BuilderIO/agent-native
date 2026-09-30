import { describe, expect, it, vi } from "vitest";

import type { AgentEvent, AgentTransport } from "../protocol/index.js";
import { AgentKitClient } from "./client.js";

function event(sequence: number, value: Record<string, unknown>): AgentEvent {
  return {
    id: `event-${sequence}`,
    threadId: "thread-1",
    runId: "run-1",
    sequence,
    occurredAt: "2026-09-28T00:00:00.000Z",
    ...value,
  } as AgentEvent;
}

function transport(): AgentTransport {
  return {
    async startRun() {
      return { runId: "run-1" };
    },
    async *subscribeToRun() {
      yield event(1, { type: "run.started" });
      yield event(2, { type: "run.completed" });
    },
    async cancelRun() {},
  };
}

describe("AgentKit terminal and continuation ownership", () => {
  it("does not resurrect a resolved approval from an older event during hydration", async () => {
    const adapter = transport();
    adapter.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
      messages: [],
      approvals: [],
      events: [
        event(1, {
          type: "approval.requested",
          request: { id: "approval-1", title: "Continue?" },
        }),
      ],
    });
    const client = new AgentKitClient({ transport: adapter });
    await client.loadThread("thread-1");
    expect(client.getThread("thread-1").approvals).toEqual({});
    expect(client.getThread("thread-1").approvalRunIds).toEqual({});
    await client.dispose();
  });

  it("reports a history refresh failure without retrying or failing completed work", async () => {
    const adapter = transport();
    const subscribe = vi.fn(adapter.subscribeToRun);
    adapter.subscribeToRun = subscribe;
    adapter.getThreadSnapshot = vi.fn(async () => {
      throw new Error("History unavailable");
    });
    const client = new AgentKitClient({
      transport: adapter,
      reconnect: { attempts: 0 },
    });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });

    await expect(run.completed).resolves.toBeUndefined();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "completed",
    );
    expect(client.getSnapshot()).toMatchObject({
      connection: "error",
      error: { code: "thread_load_failed", message: "History unavailable" },
    });
    await client.dispose();
  });

  it("preserves a terminal event if its transport fails while closing", async () => {
    const adapter = transport();
    adapter.subscribeToRun = vi.fn(async function* () {
      yield event(1, { type: "run.started" });
      yield event(2, { type: "run.completed" });
      throw new Error("Stream closed unexpectedly");
    });
    adapter.persistThreadSnapshot = vi.fn(async () => undefined);
    const client = new AgentKitClient({
      transport: adapter,
      reconnect: { attempts: 0 },
    });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });

    await expect(run.completed).resolves.toBeUndefined();
    expect(adapter.subscribeToRun).toHaveBeenCalledOnce();
    expect(adapter.persistThreadSnapshot).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "completed",
    );
    expect(client.getSnapshot().error?.message).toBe(
      "Stream closed unexpectedly",
    );
    await client.dispose();
  });

  it("acknowledges connection resolution while the existing stream continues", async () => {
    const finish = Promise.withResolvers<void>();
    const adapter = transport();
    adapter.capabilities = { connectionRequests: true };
    adapter.resolveConnectionRequest = vi.fn(async () => undefined);
    adapter.subscribeToRun = vi.fn(async function* () {
      yield event(1, { type: "run.started" });
      yield event(2, {
        type: "connection.requested",
        request: {
          id: "connection-1",
          provider: "slack",
          reason: "connect",
          status: "requested",
          createdAt: "2026-09-28T00:00:00.000Z",
        },
      });
      await finish.promise;
      yield event(3, { type: "run.completed" });
    });
    const client = new AgentKitClient({
      transport: adapter,
      reconnect: { attempts: 0 },
    });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    const resolved = vi.fn();
    const resolution = client
      .resolveConnectionRequest({
        threadId: "thread-1",
        runId: "run-1",
        requestId: "connection-1",
        response: { status: "connected" },
      })
      .then(resolved);
    try {
      await vi.waitFor(() => expect(resolved).toHaveBeenCalledOnce(), {
        timeout: 100,
      });
      expect(adapter.subscribeToRun).toHaveBeenCalledOnce();
    } finally {
      finish.resolve();
      await run.completed;
      await resolution;
      await client.dispose();
    }
  });

  it("reattaches after a connection interruption closes during resolution", async () => {
    const close = Promise.withResolvers<void>();
    const adapter = transport();
    adapter.capabilities = { connectionRequests: true };
    adapter.resolveConnectionRequest = vi.fn(async () => undefined);
    let subscriptions = 0;
    adapter.subscribeToRun = vi.fn(async function* () {
      if (++subscriptions === 1) {
        yield event(1, { type: "run.started" });
        yield event(2, {
          type: "connection.requested",
          request: {
            id: "connection-1",
            provider: "slack",
            reason: "connect",
            status: "requested",
            createdAt: "2026-09-28T00:00:00.000Z",
          },
        });
        await close.promise;
      } else {
        yield event(3, { type: "run.completed" });
      }
    });
    const client = new AgentKitClient({
      transport: adapter,
      reconnect: { attempts: 0 },
    });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    try {
      await vi.waitFor(() =>
        expect(
          client.getThread("thread-1").connectionRequests["connection-1"],
        ).toBeDefined(),
      );
      await client.resolveConnectionRequest({
        threadId: "thread-1",
        runId: "run-1",
        requestId: "connection-1",
        response: { status: "connected" },
      });
      close.resolve();
      await run.completed;
      await vi.waitFor(
        () =>
          expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
            "completed",
          ),
        { timeout: 100 },
      );
      expect(adapter.subscribeToRun).toHaveBeenCalledTimes(2);
    } finally {
      close.resolve();
      await client.dispose();
    }
  });
});
