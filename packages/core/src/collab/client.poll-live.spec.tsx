// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
  type UseCollaborativeDocResult,
} from "./client.js";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

function emptyStateResponse(): Response {
  return new Response(
    JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
  );
}

function makeFetchMock() {
  const pollCalls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/collab\/[^/]+\/state/.test(url)) return emptyStateResponse();
    if (url.includes("/_agent-native/poll")) {
      pollCalls.push(url);
      return new Response(JSON.stringify({ version: 1, events: [] }));
    }
    if (url.includes("/awareness")) {
      return new Response(JSON.stringify({ states: [] }));
    }
    return new Response(JSON.stringify({}));
  });
  return { mock, pollCalls };
}

function Probe({
  docId,
  onResult,
}: {
  docId: string;
  onResult: (result: UseCollaborativeDocResult) => void;
}) {
  const result = useCollaborativeDoc({ docId });
  onResult(result);
  return null;
}

describe("collab poll cadence with poll-live", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];

  function mount(node: React.ReactElement): Root {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    act(() => {
      root.render(node);
    });
    return root;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    for (const container of containers) {
      container.remove();
    }
    roots = [];
    containers = [];
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("relaxes to the SSE-connected poll cadence (12s) once the shared transport reports poll-live, instead of the SSE-down cadence (2s)", async () => {
    const { mock, pollCalls } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    mount(<Probe docId="poll-live-doc" onResult={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(1);
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.CLOSED;
    act(() => {
      source.onerror?.();
    });

    const pollsAtRefusal = pollCalls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(pollCalls.length).toBe(pollsAtRefusal);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_500);
    });
    expect(pollCalls.length).toBeGreaterThan(pollsAtRefusal);
  });
});
