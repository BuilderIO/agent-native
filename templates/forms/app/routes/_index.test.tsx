// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentChatHomeMock = vi.hoisted(() => vi.fn());
const navigateWithAgentChatViewTransitionMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  AgentChatHome: (props: Record<string, unknown>) => {
    agentChatHomeMock(props);
    return (
      <div data-testid="agent-chat-home">
        {props.composerSlot as React.ReactNode}
      </div>
    );
  },
  appPath: (path: string) => path,
  navigateWithAgentChatViewTransition: navigateWithAgentChatViewTransitionMock,
}));

vi.mock("react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import Index from "./_index.js";

describe("Forms ask home", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    vi.clearAllMocks();
  });

  it("keeps the full-page chat wired to the shared Forms thread state", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(<Index />);
    });

    expect(agentChatHomeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: "forms",
        showHeader: false,
        showTabBar: false,
      }),
    );
    expect(agentChatHomeMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "restoreActiveThread",
      false,
    );
    expect(container.textContent).toContain("What do you want to do?");
  });
});
