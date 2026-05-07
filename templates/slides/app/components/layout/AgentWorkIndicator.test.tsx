// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { focusAgentChat } from "@agent-native/core/client";

vi.mock("@agent-native/core/client", () => ({
  focusAgentChat: vi.fn(),
}));

import {
  AgentWorkIndicator,
  isAgentSidebarVisible,
} from "./AgentWorkIndicator";

function setVisibleRect(element: HTMLElement) {
  element.getBoundingClientRect = () =>
    ({
      width: 360,
      height: 640,
      top: 0,
      left: 0,
      right: 360,
      bottom: 640,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function dispatchRunning(isRunning: boolean) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning },
      }),
    );
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("AgentWorkIndicator", () => {
  it("detects a visible agent sidebar panel", () => {
    expect(isAgentSidebarVisible()).toBe(false);

    const panel = document.createElement("div");
    panel.className = "agent-sidebar-panel";
    panel.style.display = "flex";
    setVisibleRect(panel);
    document.body.append(panel);

    expect(isAgentSidebarVisible()).toBe(true);

    panel.setAttribute("aria-hidden", "true");
    expect(isAgentSidebarVisible()).toBe(false);
  });

  it("shows while the agent is working when the sidebar is hidden", () => {
    render(<AgentWorkIndicator />);

    dispatchRunning(true);

    expect(screen.getByText("Agent is working")).toBeTruthy();
  });

  it("hides when the agent sidebar becomes visible", async () => {
    render(<AgentWorkIndicator />);
    dispatchRunning(true);
    expect(screen.getByText("Agent is working")).toBeTruthy();

    const panel = document.createElement("div");
    panel.className = "agent-sidebar-panel";
    panel.style.display = "flex";
    setVisibleRect(panel);
    document.body.append(panel);

    await waitFor(() => {
      expect(screen.queryByText("Agent is working")).toBeNull();
    });
  });

  it("keeps Open chat behavior when the banner is shown", () => {
    const modeListener = vi.fn();
    window.addEventListener("agent-panel:set-mode", modeListener);
    render(<AgentWorkIndicator />);
    dispatchRunning(true);

    fireEvent.click(screen.getByRole("button", { name: /open chat/i }));

    expect(modeListener).toHaveBeenCalledTimes(1);
    expect(modeListener.mock.calls[0][0]).toMatchObject({
      detail: { mode: "chat" },
    });
    expect(focusAgentChat).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent-panel:set-mode", modeListener);
  });
});
