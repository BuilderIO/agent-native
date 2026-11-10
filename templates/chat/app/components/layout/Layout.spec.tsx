// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({ end: vi.fn() }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app-shell/header-actions", () => ({
  HeaderActionsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useHeaderTitle: () => null,
  useHeaderActions: () => null,
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/rail", () => ({
  isAgentChatHomeHandoffActive: () => false,
  useAgentChatHomeHandoff: () => false,
  useAgentChatHomeHandoffLinks: () => undefined,
}));
vi.mock("@agent-native/toolkit/app/chat/composer", () => ({
  RealtimeVoiceModeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useRealtimeVoiceModeOptional: () => ({ end: voice.end }),
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  isSettingsPathname: (pathname: string) => pathname.startsWith("/settings"),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: () => null,
  SheetContent: () => null,
  SheetDescription: () => null,
  SheetTitle: () => null,
}));
vi.mock("@/lib/app-config", () => ({ APP_TITLE: "Chat" }));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "layout-tab" }));
vi.mock("./Header", () => ({ Header: () => null }));
vi.mock("./MobileAppBar", () => ({ MobileAppBar: () => null }));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./AgentInspector", () => ({
  AgentInspector: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { Layout } from "./Layout";

describe("Layout voice chat", () => {
  let container: HTMLDivElement;
  let root: Root;
  let navigate: NavigateFunction;

  function CaptureNavigate() {
    navigate = useNavigate();
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    voice.end.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderLayout(pathname: string) {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[pathname]}>
          <Layout>
            <CaptureNavigate />
          </Layout>
        </MemoryRouter>,
      ),
    );
  }

  it("keeps the session when Get started hands off into a chat", async () => {
    await renderLayout("/home");

    await act(async () => navigate("/chat/chat-1"));
    await act(async () => navigate("/chat/chat-2"));

    expect(voice.end).not.toHaveBeenCalled();
  });

  it("ends the session on navigation to a page without voice controls", async () => {
    await renderLayout("/chat/chat-1");

    await act(async () => navigate("/settings"));

    expect(voice.end).toHaveBeenCalledOnce();
  });
});
