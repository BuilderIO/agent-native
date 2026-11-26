// @vitest-environment happy-dom

import { getBrowserTabId } from "@agent-native/core/client/browser-tab-id";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const railState = vi.hoisted(() => ({
  sidebarProps: [] as Array<Record<string, unknown>>,
  fetchImpl: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ startUrl: "about:blank" }),
}));

vi.mock("@agent-native/toolkit/app/chat/AgentSidebar", () => ({
  AgentSidebar: (props: Record<string, unknown>) => {
    railState.sidebarProps.push(props);
    return (
      <div data-agent-sidebar data-api-url={String(props.apiUrl ?? "")}>
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/toolkit/app/chat/chat-first/app-pane", () => ({
  ChatFirstAppPane: ({
    app,
    embedUrl,
    renderEmbed,
  }: {
    app: { name: string } | null;
    embedUrl?: string | null;
    renderEmbed: (embed: { url: string }) => React.ReactNode;
  }) => (
    <div data-app-pane>
      {app?.name}
      {embedUrl ? renderEmbed({ url: embedUrl }) : null}
    </div>
  ),
}));

vi.mock("@agent-native/toolkit/app/chat/chat-first-copy", () => ({
  defaultChatFirstCopy: (key: string) => key,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: railState.mutateAsync }),
  useActionQuery: () => ({
    data: [],
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? key,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import {
  useWorkspaceAppChildBrowserTab,
  WorkspaceAppChatRail,
  WorkspaceAppFrame,
} from "./workspace-app-host";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("WorkspaceAppChatRail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    railState.sidebarProps.length = 0;
    railState.fetchImpl.mockReset();
    vi.stubGlobal("fetch", railState.fetchImpl);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.happyDOM?.settings &&
      (window.happyDOM.settings.disableIframePageLoading = true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(node: React.ReactNode) {
    await act(async () => {
      root.render(node);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("points the rail at the app's own agent through the Dispatch proxy", async () => {
    railState.fetchImpl.mockResolvedValue(
      jsonResponse(200, { devMode: false, canToggle: false }),
    );

    await render(
      <WorkspaceAppChatRail appId="mail" appName="Mail">
        <div data-app-surface />
      </WorkspaceAppChatRail>,
    );

    expect(railState.fetchImpl).toHaveBeenCalledWith(
      "/_agent-native/workspace-app-chat/mail/mode",
      { credentials: "include" },
    );
    const sidebar = container.querySelector("[data-agent-sidebar]");
    expect(sidebar?.getAttribute("data-api-url")).toBe(
      "/_agent-native/workspace-app-chat/mail",
    );
    expect(container.querySelector("[data-app-surface]")).not.toBeNull();
  });

  it("shows an error instead of quietly answering from Dispatch's own agent", async () => {
    railState.fetchImpl.mockResolvedValue(
      jsonResponse(502, { error: "mail chat is unavailable: no app session" }),
    );

    await render(
      <WorkspaceAppChatRail appId="mail" appName="Mail">
        <div data-app-surface />
      </WorkspaceAppChatRail>,
    );

    expect(
      container.querySelector("[data-dispatch-app-chat-unavailable]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-agent-sidebar]")).toBeNull();
    expect(container.querySelector("[data-app-surface]")).not.toBeNull();
  });

  it("answers the app's chat toggle by focusing retry while unavailable", async () => {
    railState.fetchImpl.mockResolvedValue(
      jsonResponse(502, { error: "mail chat is unavailable: no app session" }),
    );

    await render(
      <WorkspaceAppChatRail appId="mail" appName="Mail">
        <div data-app-surface />
      </WorkspaceAppChatRail>,
    );
    act(() => {
      window.dispatchEvent(new Event("agent-panel:toggle"));
    });

    expect(document.activeElement).toBe(
      container.querySelector("[data-dispatch-app-chat-unavailable] button"),
    );
  });

  it("re-probes the proxy when the error state is retried", async () => {
    railState.fetchImpl.mockResolvedValueOnce(
      jsonResponse(502, { error: "temporarily unavailable" }),
    );
    railState.fetchImpl.mockResolvedValue(
      jsonResponse(200, { devMode: false }),
    );

    await render(
      <WorkspaceAppChatRail appId="mail" appName="Mail">
        <div data-app-surface />
      </WorkspaceAppChatRail>,
    );
    const retry = container.querySelector<HTMLButtonElement>(
      "[data-dispatch-app-chat-unavailable] button",
    );
    expect(retry).not.toBeNull();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(railState.fetchImpl).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-agent-sidebar]")).not.toBeNull();
  });

  it("sends the embedded frame's claimed tab id from the app chat rail, never Dispatch's", async () => {
    railState.fetchImpl.mockResolvedValue(
      jsonResponse(200, { devMode: false, canToggle: false }),
    );
    const childTabId = "3f9d2c1e-8a47-4b6d-9c3e-5a1b7d0e4f62";
    railState.mutateAsync.mockResolvedValue({
      startUrl: `${window.location.origin}/mail/?agentNativeTab=${childTabId}`,
      childBrowserTabId: childTabId,
    });
    const dispatchTabId = getBrowserTabId();

    function AppRoute() {
      const childTab = useWorkspaceAppChildBrowserTab();
      return (
        <WorkspaceAppChatRail
          appId="mail"
          appName="Mail"
          browserTabId={childTab.browserTabId}
        >
          <WorkspaceAppFrame
            app={{ id: "mail", name: "Mail", path: "/mail" }}
            claimBrowserTab
            onViewReaderChange={childTab.onViewReaderChange}
          />
        </WorkspaceAppChatRail>
      );
    }

    await render(<AppRoute />);
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    });
    const lastTabId = () =>
      railState.sidebarProps[railState.sidebarProps.length - 1]?.browserTabId;
    expect(lastTabId()).toEqual(expect.any(String));
    expect(lastTabId()).not.toBe(dispatchTabId);
    expect(lastTabId()).not.toBe(childTabId);

    const iframe = container.querySelector<HTMLIFrameElement>("iframe");
    if (!iframe) throw new Error("Workspace app iframe was not rendered");
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: {
        postMessage: vi.fn(),
        location: { href: `${window.location.origin}/mail/inbox` },
        document: { title: "Inbox" },
        getSelection: () => ({ toString: () => "" }),
      },
    });
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(lastTabId()).toBe(childTabId);
    expect(lastTabId()).not.toBe(dispatchTabId);
  });

  it("leaves surfaces with no open app alone — no app rail and no proxy probe", async () => {
    await render(
      <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
    );

    expect(container.querySelector("[data-agent-sidebar]")).toBeNull();
    expect(railState.fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("workspace-app-chat"),
      expect.anything(),
    );
  });
});
