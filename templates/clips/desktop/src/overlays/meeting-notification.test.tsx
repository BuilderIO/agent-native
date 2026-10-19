// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriEvents = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<(event: { payload: unknown }) => void>
  >();
  return {
    listeners,
    emit: vi.fn(async (name: string, payload: unknown) => {
      for (const listener of listeners.get(name) ?? []) listener({ payload });
    }),
    listen: vi.fn(
      async (name: string, listener: (event: { payload: unknown }) => void) => {
        const handlers = listeners.get(name) ?? new Set();
        handlers.add(listener);
        listeners.set(name, handlers);
        return () => handlers.delete(listener);
      },
    ),
  };
});
const tauriCore = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));
const tauriWindow = vi.hoisted(() => ({
  hide: vi.fn(async () => undefined),
  setSize: vi.fn(async () => undefined),
  show: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriCore.invoke }));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: tauriEvents.emit,
  listen: tauriEvents.listen,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => tauriWindow),
}));
vi.mock("../../../shared/labs", () => ({
  CLIPS_MEETINGS: "clips-meetings",
  isLabEnabled: () => true,
}));
vi.mock("../app", () => ({ loadDesktopAuthToken: () => null }));
vi.mock("../lib/meeting-notification-dismissal", () => ({
  dismissMeetingNotification: vi.fn(),
}));
vi.mock("../lib/open-meeting-join-url", () => ({
  openMeetingJoinUrl: vi.fn(),
}));
vi.mock("../lib/url", () => ({
  loadStoredServerUrl: () => "https://clips.test",
}));

import { MeetingNotification } from "./meeting-notification";

describe("meeting notification recovery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    tauriEvents.listeners.clear();
    tauriEvents.emit.mockClear();
    tauriEvents.listen.mockClear();
    tauriCore.invoke.mockClear();
    tauriWindow.hide.mockClear();
    tauriWindow.setSize.mockClear();
    tauriWindow.show.mockClear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: {} }, { status: 200 })),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<MeetingNotification />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps transcript recovery visible and requests copy before starting the replacement", async () => {
    await act(async () => {
      await tauriEvents.emit("meetings:replacement-recovery-required", {
        meetingId: "new-meeting",
        failedMeetingId: "unsaved-meeting",
      });
    });

    expect(host.textContent).toContain("meetingReplacement.title");
    expect(host.textContent).toContain("meetingReplacement.description");
    const action = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("meetingReplacement.copyAndStart"),
    );
    expect(action).toBeDefined();

    await act(async () => action!.click());
    expect(tauriEvents.emit).toHaveBeenCalledWith(
      "meetings:replacement-copy-and-start-request",
      {
        meetingId: "new-meeting",
        failedMeetingId: "unsaved-meeting",
      },
    );
    expect((action as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await tauriEvents.emit("meetings:replacement-recovery-action-failed", {
        meetingId: "new-meeting",
      });
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "meetingReplacement.actionFailed",
    );
  });
});
