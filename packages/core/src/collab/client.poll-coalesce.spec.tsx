// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as dbSync from "../client/use-db-sync.js";
import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
} from "./client.js";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

const POLL_RESPONSE_DELAY_MS = 500;

function slowPollFetch() {
  const polls = { started: 0 };
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/collab\/[^/]+\/state/.test(url)) {
      return new Response(
        JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
      );
    }
    if (url.includes("/_agent-native/poll")) {
      polls.started += 1;
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_RESPONSE_DELAY_MS),
      );
      return new Response(JSON.stringify({ version: 1, events: [] }));
    }
    if (url.includes("/awareness")) {
      return new Response(JSON.stringify({ states: [] }));
    }
    return new Response(JSON.stringify({}));
  });
  return { mock, polls };
}

function Probe({
  docId,
  withUser = false,
}: {
  docId: string;
  withUser?: boolean;
}) {
  useCollaborativeDoc({
    docId,
    user: withUser
      ? { name: "Ada", email: "ada@example.com", color: "#123456" }
      : undefined,
  });
  return null;
}

describe("collab polling while a poll is in flight", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps one polling chain when focus asks for a poll mid-flight", async () => {
    const { mock, polls } = slowPollFetch();
    vi.stubGlobal("fetch", mock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe docId="poll-coalesce-doc" />));
    const pollsDuring = async (ms: number) => {
      const before = polls.started;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      return polls.started - before;
    };
    await pollsDuring(3_000);
    const quietWindow = await pollsDuring(20_000);

    for (let index = 0; index < 4; index += 1) {
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await pollsDuring(100);
    }
    await pollsDuring(3_000);

    expect(await pollsDuring(20_000)).toBeLessThanOrEqual(quietWindow + 1);
  });

  it("abandons a poll that never settles so polling resumes", async () => {
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          return new Response(
            JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
          );
        }
        if (url.includes("/_agent-native/poll")) {
          polls += 1;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        }
        return new Response(JSON.stringify({ states: [] }));
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe docId="poll-hang-doc" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const hung = polls;
    expect(hung).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(polls).toBeGreaterThanOrEqual(hung + 2);
  });

  it.each(["request", "body"] as const)(
    "resumes polling after an awareness %s stalls without failing document sync",
    async (boundary) => {
      vi.spyOn(dbSync, "subscribeSyncEvents").mockReturnValue(() => {});
      let polls = 0;
      let awarenessRequests = 0;
      let awarenessSignal: AbortSignal | null | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (/\/collab\/[^/]+\/state/.test(url)) {
            return new Response(
              JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
            );
          }
          if (url.includes("/_agent-native/poll")) {
            polls += 1;
            return new Response(JSON.stringify({ version: 1, events: [] }));
          }
          if (url.endsWith("/awareness")) {
            awarenessRequests += 1;
            if (awarenessRequests === 1) {
              awarenessSignal = init?.signal;
              if (boundary === "request") {
                return new Promise<Response>((_resolve, reject) => {
                  init?.signal?.addEventListener("abort", () =>
                    reject(new DOMException("Aborted", "AbortError")),
                  );
                });
              }
              return new Response(
                new ReadableStream({
                  start(controller) {
                    init?.signal?.addEventListener("abort", () =>
                      controller.error(
                        new DOMException("Aborted", "AbortError"),
                      ),
                    );
                  },
                }),
              );
            }
          }
          return new Response(JSON.stringify({ states: [] }));
        }),
      );
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => root!.render(<Probe docId="awareness-hang-doc" withUser />));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(polls).toBe(1);
      expect(awarenessRequests).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(17_000);
      });
      expect(polls).toBe(7);
      expect(awarenessRequests).toBe(7);
      expect(awarenessSignal?.aborted).toBe(true);

      act(() => window.dispatchEvent(new Event("focus")));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(polls).toBe(8);
    },
  );
});
