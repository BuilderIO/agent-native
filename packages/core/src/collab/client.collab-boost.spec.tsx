// @vitest-environment happy-dom

/**
 * A collab doc whose awareness shows another visible person holds the shared
 * transport's poll boost; when that person is gone (or hidden) it is released.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrowserTabId } from "../client/browser-tab-id.js";
import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
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
  addEventListener(): void {}
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

const USER = { name: "Me", email: "me@example.test", color: "#111111" };

function Probe({ docId }: { docId: string }) {
  useCollaborativeDoc({
    docId,
    user: USER,
    activityResource: { resourceType: "design", resourceId: "d1" },
  });
  return null;
}

describe("collab poll boost from presence", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];
  let others: Array<{ clientId: number; state: string }> = [];
  let sharedPolls = 0;
  let ownPollEvents: Array<Record<string, unknown>> = [];

  function human(email: string, visible = true, clientId = 4242) {
    return {
      clientId,
      state: JSON.stringify({
        user: { name: email, email, color: "#222222" },
        visible,
      }),
    };
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function mountRefused() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    act(() => root.render(<Probe docId="boost-doc" />));
    await advance(50);
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.CLOSED;
    act(() => source.onerror?.());
    await advance(50);
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    vi.useFakeTimers();
    others = [];
    sharedPolls = 0;
    ownPollEvents = [];
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          return new Response(
            JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
          );
        }
        if (url.includes("/awareness")) {
          return new Response(JSON.stringify({ states: others }));
        }
        if (url.includes("/_agent-native/poll")) {
          // Collab's own poll sends only ?since=; the shared transport adds a
          // composite cursor= once it has seen a version.
          if (url.includes("cursor=")) {
            sharedPolls += 1;
            return new Response(JSON.stringify({ version: 1, events: [] }));
          }
          const events = ownPollEvents;
          ownPollEvents = [];
          return new Response(JSON.stringify({ version: 1, events }));
        }
        return new Response(JSON.stringify({}));
      }),
    );
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots = [];
    containers = [];
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("boosts the shared transport once another visible person is present, and releases when they leave", async () => {
    await mountRefused();

    await advance(30_000);
    const aloneAt = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - aloneAt).toBeLessThanOrEqual(1);

    others = [human("them@example.test")];
    await advance(13_000); // collab's own 12 s poll discovers them
    const joinedAt = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - joinedAt).toBeGreaterThanOrEqual(10);

    others = [];
    await advance(13_000);
    const leftAt = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - leftAt).toBeLessThanOrEqual(1);
  });

  it("ignores the agent and hidden tabs", async () => {
    await mountRefused();
    others = [human("agent@system"), human("hidden@example.test", false, 4243)];
    await advance(13_000);
    const at = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - at).toBeLessThanOrEqual(1);
  });

  // A viewer on a different screen shares no doc with the editor, so presence
  // never shows them; its own connection's poll still carries the design's
  // resource-scoped events from the other screens.
  it("boosts when its own poll carries another tab's event on the open resource", async () => {
    await mountRefused();
    await advance(13_000); // first poll replays history, nothing counts yet
    ownPollEvents = [
      {
        source: "collab",
        type: "yjs-update",
        docId: "other-screen",
        requestSource: "other-tab",
        resourceType: "design",
        resourceId: "d1",
      },
    ];
    await advance(13_000);
    const at = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - at).toBeGreaterThanOrEqual(10);
  });

  it("does not boost for the history its first poll replays, this tab's own events, or another resource", async () => {
    ownPollEvents = [
      {
        source: "action",
        key: "update-file",
        requestSource: "other-tab",
        resourceType: "design",
        resourceId: "d1",
      },
    ];
    await mountRefused();
    await advance(13_000);
    const replayedAt = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - replayedAt).toBeLessThanOrEqual(1);

    ownPollEvents = [
      {
        source: "collab",
        docId: "other-screen",
        requestSource: getBrowserTabId(),
        resourceType: "design",
        resourceId: "d1",
      },
      // The server mirrors this tab's own file saves into Yjs as "agent".
      {
        source: "collab",
        docId: "this-screen",
        requestSource: "agent",
        resourceType: "design",
        resourceId: "d1",
      },
      {
        source: "action",
        key: "update-file",
        requestSource: "other-tab",
        resourceType: "design",
        resourceId: "d2",
      },
    ];
    await advance(13_000);
    const at = sharedPolls;
    await advance(30_000);
    expect(sharedPolls - at).toBeLessThanOrEqual(1);
  });
});
