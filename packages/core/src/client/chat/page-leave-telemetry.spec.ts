// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearActiveRun, setActiveRun } from "../active-run-state.js";
import { installAgentChatPageLeaveTracking } from "./page-leave-telemetry.js";

function transitionEvent(
  type: string,
  persisted: boolean,
): PageTransitionEvent {
  const event = new Event(type) as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

describe("agent_chat_page_left", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    clearActiveRun();
    window.history.replaceState({}, "", "/design/private-design-id");
    Object.defineProperty(window, "__reactRouterManifest", {
      configurable: true,
      value: {
        routes: {
          design: { id: "design", path: "/design/:designId" },
        },
      },
    });
  });

  afterEach(() => {
    dispose?.();
    clearActiveRun();
    delete (window as Window & { __reactRouterManifest?: unknown })
      .__reactRouterManifest;
  });

  it("records an active-run boolean and route template without identifiers", () => {
    const send = vi.fn();
    setActiveRun({
      threadId: "thread-private",
      runId: "run-private",
      lastSeq: 3,
    });
    dispose = installAgentChatPageLeaveTracking(send);

    window.dispatchEvent(transitionEvent("pagehide", false));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "agent_chat_page_left",
      expect.objectContaining({
        active_run: true,
        route_template: "/design/:designId",
        bfcache_persisted: false,
      }),
    );
    const event = JSON.stringify(send.mock.calls[0]);
    expect(event).not.toContain("thread-private");
    expect(event).not.toContain("run-private");
    expect(event).not.toContain("private-design-id");

    window.dispatchEvent(transitionEvent("pagehide", false));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records idle state and allows a new leave after a BFCache restoration", () => {
    const send = vi.fn();
    dispose = installAgentChatPageLeaveTracking(send);

    window.dispatchEvent(transitionEvent("pagehide", true));
    window.dispatchEvent(transitionEvent("pageshow", true));
    window.dispatchEvent(transitionEvent("pagehide", false));

    expect(send.mock.calls).toEqual([
      [
        "agent_chat_page_left",
        expect.objectContaining({
          active_run: false,
          route_template: "/design/:designId",
          bfcache_persisted: true,
        }),
      ],
      [
        "agent_chat_page_left",
        expect.objectContaining({
          active_run: false,
          route_template: "/design/:designId",
          bfcache_persisted: false,
        }),
      ],
    ]);
  });

  it("installs one listener when tracking is configured more than once", () => {
    const send = vi.fn();
    dispose = installAgentChatPageLeaveTracking(send);
    const secondDispose = installAgentChatPageLeaveTracking(send);

    window.dispatchEvent(transitionEvent("pagehide", false));

    expect(send).toHaveBeenCalledTimes(1);
    secondDispose();
  });
});
