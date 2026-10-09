// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/use-poll-loop", () => ({
  usePollLoop: (refresh: () => Promise<void>) => {
    useEffect(() => {
      void refresh();
    }, [refresh]);
  },
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentToggleButton: () => <button type="button">Agent</button>,
}));

import { HeaderActions } from "./HeaderActions";

describe("Calendar header actions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
    ok: true,
    json: async () => ({ count: 3 }),
  }));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows unread notifications sent by the agent or an automation", async () => {
    await act(async () => root.render(<HeaderActions />));

    const bell = container.querySelector(".an-notifications-bell__trigger");
    expect(bell?.getAttribute("aria-label")).toBe("3 unread notifications");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/_agent-native/notifications/count",
    );
  });
});
