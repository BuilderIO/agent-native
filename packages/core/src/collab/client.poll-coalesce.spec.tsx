// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function Probe({ docId }: { docId: string }) {
  useCollaborativeDoc({ docId });
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
});
