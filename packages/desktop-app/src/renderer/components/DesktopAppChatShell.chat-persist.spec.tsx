// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeDesktopChatPreferences } from "../lib/desktop-chat-preferences.js";
import DesktopAppChatShell from "./DesktopAppChatShell.js";

const sidebarMountCounts = new Map<string, number>();
const sidebarRestoreProps = new Map<string, boolean | undefined>();

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatMemoryRouter: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AgentSidebar: ({
    children,
    scope,
    restoreActiveThread,
  }: {
    children: React.ReactNode;
    scope?: { id?: string };
    restoreActiveThread?: boolean;
  }) => {
    const id = scope?.id ?? "unknown";
    sidebarRestoreProps.set(id, restoreActiveThread);
    useEffect(() => {
      sidebarMountCounts.set(id, (sidebarMountCounts.get(id) ?? 0) + 1);
    }, [id]);
    return <>{children}</>;
  },
}));

vi.mock("@agent-native/toolkit/app/chat/AgentSidebar", () => ({
  preloadAgentChatSurface: vi.fn(() => Promise.resolve()),
}));

describe("DesktopAppChatShell app-switch chat persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    writeDesktopChatPreferences({ resetChatOnAppSwitch: false });
    sidebarMountCounts.clear();
    sidebarRestoreProps.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("electronAPI", {
      desktopChat: {
        getApiUrl: async (appId: string) =>
          `http://127.0.0.1:43101/desktop-chat/secret/${appId}/_agent-native/agent-chat`,
      },
      codeAgents: { listModels: async () => ({ models: [] }) },
      appConfig: {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("persists chat across app switches by default (resetChatOnAppSwitch = false)", async () => {
    await act(async () => {
      root.render(
        <DesktopAppChatShell appId="mail" appName="Mail" isActive>
          <div>mail</div>
        </DesktopAppChatShell>,
      );
      await Promise.resolve();
    });

    expect(sidebarMountCounts.get("mail")).toBe(1);
    expect(sidebarRestoreProps.get("mail")).toBe(true);

    await act(async () => {
      root.render(
        <DesktopAppChatShell appId="mail" appName="Mail" isActive={false}>
          <div>mail</div>
        </DesktopAppChatShell>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <DesktopAppChatShell appId="mail" appName="Mail" isActive>
          <div>mail</div>
        </DesktopAppChatShell>,
      );
      await Promise.resolve();
    });

    expect(sidebarMountCounts.get("mail")).toBe(1);
    expect(sidebarRestoreProps.get("mail")).toBe(true);
  });

  it("resets chat when switching apps when resetChatOnAppSwitch = true", async () => {
    await act(async () => {
      writeDesktopChatPreferences({ resetChatOnAppSwitch: true });
      root.render(
        <DesktopAppChatShell appId="mail" appName="Mail" isActive>
          <div>mail</div>
        </DesktopAppChatShell>,
      );
      await Promise.resolve();
    });

    expect(sidebarMountCounts.get("mail")).toBe(1);
    expect(sidebarRestoreProps.get("mail")).toBe(false);

    await act(async () => {
      root.render(
        <DesktopAppChatShell appId="mail" appName="Mail" isActive={false}>
          <div>mail</div>
        </DesktopAppChatShell>,
      );
      await Promise.resolve();
    });

    expect(sidebarMountCounts.get("mail")).toBe(2);
    expect(sidebarRestoreProps.get("mail")).toBe(false);
  });
});
