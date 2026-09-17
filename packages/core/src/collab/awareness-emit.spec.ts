/**
 * Tests for awareness SSE fast-path emission.
 *
 * Validates that postAwareness emits an AWARENESS_CHANGE_EVENT after storing
 * a client's state, so SSE-connected peers can receive cursor updates push-style.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (event: unknown, name: string) =>
    (event as any)._params?.[name],
  setResponseStatus: (event: unknown, status: number) => {
    (event as any)._status = status;
  },
}));

const mockReadBody = vi.fn();
vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

import {
  getDocAwareness,
  getAwarenessEmitter,
  AWARENESS_CHANGE_EVENT,
  postAwareness,
  type AwarenessChangeEvent,
} from "./awareness.js";

function event(params: Record<string, string> = {}) {
  return { _params: params, _status: 200 } as unknown;
}

function scopedEvent(params: Record<string, string> = {}) {
  return {
    _params: params,
    _status: 200,
    context: {
      _collabAwarenessScope: {
        owner: "owner@example.com",
        orgId: "org-1",
        resourceType: "deck",
        resourceId: "deck-1",
      },
    },
  } as unknown;
}

describe("postAwareness SSE fast-path", () => {
  beforeEach(() => {
    getDocAwareness("emit-doc").clear();
    mockReadBody.mockReset();
  });

  afterEach(() => {
    getDocAwareness("emit-doc").clear();
  });

  it("emits AWARENESS_CHANGE_EVENT after storing a new state", async () => {
    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    mockReadBody.mockResolvedValue({
      clientId: 10,
      state: JSON.stringify({ user: { name: "Alice", email: "alice@ex.com" } }),
    });

    await postAwareness(event({ docId: "emit-doc" }) as any);

    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);

    expect(received).toHaveLength(1);
    expect(received[0].source).toBe("awareness");
    expect(received[0].type).toBe("awareness-change");
    expect(received[0].docId).toBe("emit-doc");
    expect(received[0].states).toHaveLength(1);
    expect(received[0].states[0].clientId).toBe(10);
  });

  it("copies collab resource scope onto awareness events", async () => {
    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    mockReadBody.mockResolvedValue({
      clientId: 10,
      state: JSON.stringify({ user: { name: "Alice", email: "alice@ex.com" } }),
    });

    await postAwareness(scopedEvent({ docId: "emit-doc" }) as any);
    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);

    expect(received[0]).toMatchObject({
      owner: "owner@example.com",
      orgId: "org-1",
      resourceType: "deck",
      resourceId: "deck-1",
    });
  });

  it("emits event with all current clients (including the sender)", async () => {
    // Pre-seed another client.
    const map = getDocAwareness("emit-doc");
    map.set(99, {
      clientId: 99,
      state: JSON.stringify({ user: { name: "Bob", email: "bob@ex.com" } }),
      lastSeen: Date.now(),
    });

    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    mockReadBody.mockResolvedValue({
      clientId: 10,
      state: JSON.stringify({ user: { name: "Alice", email: "alice@ex.com" } }),
    });

    await postAwareness(event({ docId: "emit-doc" }) as any);
    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);

    expect(received[0].states).toHaveLength(2);
    const clientIds = received[0].states.map((s) => s.clientId).sort();
    expect(clientIds).toEqual([10, 99]);
  });

  it("emits event without the cleared client when state is null", async () => {
    const map = getDocAwareness("emit-doc");
    map.set(10, {
      clientId: 10,
      state: JSON.stringify({ user: { name: "Alice", email: "alice@ex.com" } }),
      lastSeen: Date.now(),
    });
    map.set(99, {
      clientId: 99,
      state: JSON.stringify({ user: { name: "Bob", email: "bob@ex.com" } }),
      lastSeen: Date.now(),
    });

    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    mockReadBody.mockResolvedValue({ clientId: 10, state: null });

    await postAwareness(event({ docId: "emit-doc" }) as any);
    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);

    expect(received[0].states).toHaveLength(1);
    expect(received[0].states[0].clientId).toBe(99);
  });

  it("accepts null state as a valid clear instead of a validation failure", async () => {
    mockReadBody.mockResolvedValue({ clientId: 5, state: null });

    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    const ev = event({ docId: "emit-doc" }) as any;
    await postAwareness(ev);

    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);
    expect(ev._status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].states).toEqual([]);
  });

  it("does not emit when docId is missing (validation failure)", async () => {
    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    await postAwareness(event({}) as any); // No docId

    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);
    expect(received).toHaveLength(0);
  });

  it("does not emit when clientId or state is missing", async () => {
    mockReadBody.mockResolvedValue({ clientId: 5 }); // missing state

    const received: AwarenessChangeEvent[] = [];
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, (evt) => {
      received.push(evt);
    });

    await postAwareness(event({ docId: "emit-doc" }) as any);

    getAwarenessEmitter().removeAllListeners(AWARENESS_CHANGE_EVENT);
    expect(received).toHaveLength(0);
  });
});
