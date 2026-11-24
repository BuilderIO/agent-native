// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => {
  const legacyMutateAsync = vi.fn().mockImplementation(async () => ({
    startUrl: "about:blank",
  }));
  const workspaceSsoMutateAsync = vi.fn().mockImplementation(async () => ({
    startUrl: "about:blank",
  }));
  const legacyErrorMutateAsync = vi.fn();
  const actionNames: string[] = [];
  const actionQueryParams: Array<{
    name: string;
    params?: unknown;
  }> = [];
  const actionQueryOptions: Array<{
    name: string;
    options?: Record<string, unknown>;
  }> = [];
  return {
    actionNames,
    actionQueryParams,
    actionQueryOptions,
    workspaceApps: null as Array<Record<string, unknown>> | null,
    grantedApps: [
      {
        id: "analytics.agent-native.com",
        name: "Analytics",
        url: "https://analytics.agent-native.com",
      },
    ],
    legacyMutateAsync,
    legacyMutateError: null as Error | null,
    legacyErrorMutateAsync,
    inBuilderFrame: false,
    clientSurface: "web" as "web" | "electron" | "tauri",
    frameLoadHandler: null as (() => void) | null,
    suppressFrameLoad: false,
    theme: "dark" as "dark" | "light",
    workspaceSsoEnabled: false,
    workspaceSsoMutateAsync,
    sendToAgentChatAndConfirm: vi.fn(),
  };
});

vi.mock("@agent-native/toolkit/app/chat/chat-first/app-pane", () => ({
  ChatFirstAppPane: ({
    app,
    embedUrl,
    errorMessage,
    renderEmbed,
    status,
  }: {
    app: { name: string } | null;
    embedUrl?: string | null;
    errorMessage?: string;
    renderEmbed: (target: { url: string; title?: string }) => React.ReactNode;
    status: string;
  }) => (
    <div
      data-chat-first-app-embed-url={embedUrl ?? ""}
      data-chat-first-app-error={errorMessage ?? ""}
      data-chat-first-app-status={status}
    >
      {status === "ready" && embedUrl
        ? (() => {
            const frame = renderEmbed({ url: embedUrl, title: app?.name });
            if (clientState.suppressFrameLoad && React.isValidElement(frame)) {
              clientState.frameLoadHandler =
                (frame.props as { onLoad?: () => void }).onLoad ?? null;
              return React.cloneElement(frame, {
                onLoad: undefined,
                src: undefined,
              });
            }
            return frame;
          })()
        : null}
    </div>
  ),
}));

vi.mock("@agent-native/toolkit/app/chat/chat-first-copy", () => ({
  defaultChatFirstCopy: (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app/chat/AgentSidebar", () => ({
  AgentSidebar: () => null,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => clientState.workspaceSsoEnabled,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: clientState.sendToAgentChatAndConfirm,
}));

vi.mock("@agent-native/core/client/host", () => ({
  getClientSurface: () => clientState.clientSurface,
  isInBuilderFrame: () => clientState.inBuilderFrame,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string) => {
    clientState.actionNames.push(name);
    return {
      mutateAsync:
        name === "create-workspace-app-embed-session"
          ? clientState.workspaceSsoMutateAsync
          : clientState.legacyMutateError
            ? clientState.legacyErrorMutateAsync
            : clientState.legacyMutateAsync,
    };
  },
  useActionQuery: (name: string, params?: unknown, options?: unknown) => {
    clientState.actionQueryParams.push({ name, params });
    clientState.actionQueryOptions.push({
      name,
      options:
        options && typeof options === "object"
          ? (options as Record<string, unknown>)
          : undefined,
    });
    return {
      data:
        name === "list_apps"
          ? { apps: clientState.grantedApps }
          : (clientState.workspaceApps ?? [
              {
                id: "mail",
                name: "Mail",
                path: "/mail",
                url: null,
                status: "ready",
              },
              {
                id: "calendar",
                name: "Calendar",
                path: "/calendar",
                url: null,
                status: "ready",
              },
              {
                id: "documents",
                name: "Documents",
                path: "/documents",
                url: null,
                status: "ready",
              },
              {
                id: "settings",
                name: "Settings",
                path: "/settings",
                url: null,
                status: "ready",
              },
            ]),
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: clientState.theme }),
}));

import {
  WorkspaceAppFrame,
  WorkspaceAppHost,
  WorkspaceAppKeepAlive,
} from "./workspace-app-host";

function postGuestReply(port: MessagePort, result: unknown): Promise<void> {
  const handled = Promise.withResolvers<void>();
  port.addEventListener("close", () => handled.resolve(), { once: true });
  port.postMessage(result);
  return handled.promise;
}

describe("WorkspaceAppKeepAlive", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clientState.actionNames.length = 0;
    clientState.actionQueryParams.length = 0;
    clientState.actionQueryOptions.length = 0;
    clientState.workspaceApps = null;
    clientState.legacyMutateAsync.mockImplementation(async () => ({
      startUrl: "about:blank",
    }));
    clientState.legacyMutateAsync.mockClear();
    clientState.legacyMutateError = null;
    clientState.legacyErrorMutateAsync.mockReset();
    clientState.inBuilderFrame = false;
    clientState.clientSurface = "web";
    clientState.frameLoadHandler = null;
    clientState.suppressFrameLoad = false;
    clientState.workspaceSsoMutateAsync.mockClear();
    clientState.theme = "dark";
    clientState.workspaceSsoEnabled = false;
    clientState.sendToAgentChatAndConfirm.mockReset();
    clientState.sendToAgentChatAndConfirm.mockResolvedValue({
      tabId: "active",
      delivered: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: window,
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: window,
    });
    vi.unstubAllGlobals();
  });

  it("keeps visited app frames in the DOM while hiding inactive apps", async () => {
    await act(async () => {
      root.render(<WorkspaceAppKeepAlive activeAppId="mail" />);
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<WorkspaceAppKeepAlive activeAppId="calendar" />);
      await Promise.resolve();
    });

    const mailEntry = container.querySelector<HTMLElement>(
      '[data-dispatch-workspace-app-cache-entry="mail"]',
    );
    const calendarEntry = container.querySelector<HTMLElement>(
      '[data-dispatch-workspace-app-cache-entry="calendar"]',
    );

    expect(mailEntry).not.toBeNull();
    expect(mailEntry?.classList.contains("hidden")).toBe(true);
    expect(mailEntry?.querySelector("iframe")).not.toBeNull();
    expect(calendarEntry?.classList.contains("hidden")).toBe(false);
    expect(calendarEntry?.querySelector("iframe")).not.toBeNull();
    expect(container.querySelectorAll("iframe")).toHaveLength(2);
    for (const iframe of container.querySelectorAll("iframe")) {
      expect(iframe.getAttribute("allow")?.split(/;\s*/)).toEqual(
        expect.arrayContaining([
          "clipboard-read",
          "clipboard-write",
          "fullscreen",
        ]),
      );
    }
    expect(
      clientState.actionQueryParams.find(
        (query) => query.name === "list-workspace-apps",
      )?.params,
    ).toEqual({ includeAgentCards: false, includeArchived: true });
    expect(
      clientState.actionQueryParams.some((query) => query.name === "list_apps"),
    ).toBe(false);
  });

  it("does not resolve apps granted through Dispatch MCP", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceAppKeepAlive activeAppId="analytics.agent-native.com" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-chat-first-app-status="ready"]'),
    ).toBeNull();
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(
      clientState.actionQueryParams.some((query) => query.name === "list_apps"),
    ).toBe(false);
    expect(
      clientState.actionQueryParams.some(
        (query) => query.name === "list-connected-agents",
      ),
    ).toBe(false);
  });

  it("does not resolve archived workspace apps from granted discovery", async () => {
    clientState.workspaceApps = [
      {
        id: "analytics.agent-native.com",
        name: "Hidden app",
        path: "/hidden-app",
        url: null,
        status: "ready",
        archived: true,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceAppKeepAlive activeAppId="analytics.agent-native.com" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-chat-first-app-status="ready"]'),
    ).toBeNull();
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
  });

  it("uses the app-scoped workspace session action when the rollout is enabled", async () => {
    clientState.workspaceSsoEnabled = true;

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "mail",
            name: "Mail",
            path: "/mail",
            url: "https://mail.agent-native.com",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.workspaceSsoMutateAsync).toHaveBeenCalledWith({
      app: "mail",
      url: "https://mail.agent-native.com/home",
      chrome: "minimal",
    });
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
  });

  it("uses the granted-app session when a mounted app reuses a canonical id", async () => {
    clientState.workspaceSsoEnabled = true;

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "mail",
            name: "Internal Mail",
            path: "/mail",
            url: "https://agent-workspace.builder.io/mail",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "mail",
      url: "https://agent-workspace.builder.io/mail",
      chrome: "minimal",
    });
    expect(clientState.workspaceSsoMutateAsync).not.toHaveBeenCalled();
  });

  it("uses a registered workspace home path for embedded sessions", async () => {
    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "mail",
            name: "Mail",
            path: "/mail",
            homePath: "/inbox",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "mail",
      path: "/mail/inbox",
      chrome: "minimal",
    });
  });

  it.each([
    ["coach", "/", "/"],
    ["onboarding", "/accounts", "/accounts"],
  ])(
    // Retired deliberately: this used to require a same-origin app to be
    // framed through an embed session at its home path. That session is an
    // ordinary embed scope, which may only read its own document and static
    // assets, so the framed app could not call a single action (measured on
    // Labs 11/5: 0 of 16 action calls returned 200 and the app rendered
    // "Couldn't load content"; the same app framed directly returned 16 of 16).
    // A same-origin app shares the workspace cookie, so it now loads directly.
    "loads %s directly at its own home path when its registry url is this Dispatch's page",
    async (id, homePath, expectedPath) => {
      await act(async () => {
        root.render(
          <WorkspaceAppFrame
            app={{
              id,
              name: id,
              path: `/${id}`,
              homePath,
              url: `${window.location.origin}/dispatch/apps/${id}`,
            }}
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
      expect(
        document
          .querySelector("[data-chat-first-app-embed-url]")
          ?.getAttribute("data-chat-first-app-embed-url"),
      ).toBe(`/${id}${expectedPath}`.replace(/\/+$/, ""));
    },
  );

  it("keeps a same-origin app's deep route when it loads it directly", async () => {
    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "docs",
            name: "Docs",
            path: "/docs",
            homePath: "/home",
            url: `${window.location.origin}/dispatch/apps/docs`,
          }}
          initialPath="/settings/integrations/notion"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(
      document
        .querySelector("[data-chat-first-app-embed-url]")
        ?.getAttribute("data-chat-first-app-embed-url"),
    ).toBe("/docs/settings/integrations/notion");
  });

  it("never falls back to framing this Dispatch's own page for the app", async () => {
    clientState.legacyMutateError = new Error("Embed failed");
    clientState.legacyErrorMutateAsync.mockRejectedValue(
      clientState.legacyMutateError,
    );
    clientState.suppressFrameLoad = true;

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "onboarding",
            name: "Onboarding",
            path: "/onboarding",
            homePath: "/accounts",
            url: `${window.location.origin}/dispatch/apps/onboarding`,
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-chat-first-app-embed-url]")
        ?.getAttribute("data-chat-first-app-embed-url"),
    ).toBe("/onboarding/accounts");
  });

  it("keeps a Dispatch page url on another origin as the app url", async () => {
    const url = "https://gateway.example.test/dispatch/apps/coach";

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "coach",
            name: "Coach",
            path: "/coach",
            homePath: "/",
            url,
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "coach",
      url,
      chrome: "minimal",
    });
  });

  it("uses the granted-app session action for mounted apps outside the SSO registry", async () => {
    clientState.workspaceSsoEnabled = true;

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "feedback-leaderboard",
            name: "Feedback leaderboard",
            path: "/feedback-leaderboard",
            url: "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "feedback-leaderboard",
      url: "https://agent-workspace.builder.io/feedback-leaderboard/leaderboard",
      chrome: "minimal",
    });
    expect(clientState.workspaceSsoMutateAsync).not.toHaveBeenCalled();
  });

  it("mints custom SSO before navigating a Builder-hosted surface", async () => {
    clientState.workspaceSsoEnabled = true;
    clientState.inBuilderFrame = true;
    const navigateToTopWindow = vi.fn(() => true);
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "custom-sso",
            name: "Custom SSO",
            path: "/custom-sso",
            url: "https://custom.example/custom-sso",
            workspaceSso: true,
          }}
          navigateToTopWindow={navigateToTopWindow}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.workspaceSsoMutateAsync).toHaveBeenCalledWith({
      app: "custom-sso",
      url: "https://custom.example/custom-sso",
      chrome: "minimal",
    });
    expect(navigateToTopWindow).toHaveBeenCalledWith("about:blank");
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("sends the parent origin and theme on iframe load", async () => {
    await act(async () => {
      root.render(
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const iframe = container.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe).not.toBeNull();
    if (!iframe) throw new Error("Workspace app iframe was not rendered");

    const postMessage = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { postMessage },
    });

    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
      await Promise.resolve();
    });

    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: "agentNative.frameOrigin",
        origin: window.location.origin,
      },
      "*",
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      {
        type: "agent-native-theme-update",
        theme: "dark",
        isDark: true,
      },
      "*",
    );

    clientState.theme = "light";
    await act(async () => {
      root.render(
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
      );
      await Promise.resolve();
    });

    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: "agent-native-theme-update",
        theme: "light",
        isDark: false,
      },
      "*",
    );
  });

  it("navigates a qualified app's loaded frame in place after a guest receipt", async () => {
    const origin = "https://mail.example.test";
    const startUrl = `${origin}/mail/inbox`;
    clientState.legacyMutateAsync.mockResolvedValue({ startUrl });
    clientState.suppressFrameLoad = true;
    const app = {
      id: "workspace/mail",
      name: "Mail",
      path: "/mail",
      url: `${origin}/mail`,
    };

    await act(async () => {
      root.render(<WorkspaceAppFrame app={app} embedPath="/inbox" />);
    });
    const iframe = container.querySelector("iframe");
    if (!iframe || !iframe.contentWindow) throw new Error("Missing app frame");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    const target = "/mail/threads/42?mode=all#message";
    const guestPort = Promise.withResolvers<MessagePort>();
    postMessage.mockImplementation((message, _origin, transfer) => {
      if (message?.type !== "agentNative.viewRequest") return;
      const [port] = transfer as MessagePort[];
      guestPort.resolve(port);
    });

    await act(async () => clientState.frameLoadHandler?.());
    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={app}
          embedPath="/threads/42?mode=all#message"
        />,
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "agentNative.viewRequest",
        operation: "navigate",
        path: target,
        deadline: expect.any(Number),
      },
      origin,
      [expect.objectContaining({ postMessage: expect.any(Function) })],
    );
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(clientState.legacyMutateAsync).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector("[data-chat-first-app-embed-url]")
        ?.getAttribute("data-chat-first-app-embed-url"),
    ).toBe(startUrl);
    const port = await guestPort.promise;
    await act(() => postGuestReply(port, { result: { path: target } }));
    expect(container.querySelector("iframe")).toBe(iframe);
  });

  it.each([
    { outcome: "accepted", newPath: "/threads/43" },
    { outcome: "rejected", newPath: "/threads/43" },
    { outcome: "accepted", newPath: "/inbox" },
  ])(
    "opens $newPath in the warm frame when a superseded request is $outcome",
    async ({ outcome, newPath }) => {
      const origin = "https://mail.example.test";
      clientState.legacyMutateAsync.mockResolvedValue({
        startUrl: `${origin}/mail/inbox`,
      });
      clientState.suppressFrameLoad = true;
      const app = {
        id: "workspace/mail",
        name: "Mail",
        path: "/mail",
        url: `${origin}/mail`,
      };
      const onChildRouteChange = vi.fn();
      const renderRoute = (path: string) =>
        act(async () => {
          root.render(
            <WorkspaceAppFrame
              app={app}
              embedPath={path}
              onChildRouteChange={onChildRouteChange}
            />,
          );
        });
      await renderRoute("/inbox");
      const iframe = container.querySelector("iframe");
      const source = iframe?.contentWindow;
      if (!source) throw new Error("Missing app frame");
      const ports = new Map<string, MessagePort>();
      vi.spyOn(source, "postMessage").mockImplementation(
        (message, _origin, transfer) => {
          if (message?.type !== "agentNative.viewRequest") return;
          const [port] = transfer as MessagePort[];
          ports.set(message.path, port);
        },
      );
      const reportRoute = (path: string) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "agent-native:workspace-app-route", path },
            origin,
            source,
          }),
        );
      const reply = async (path: string, result: object) => {
        const port = ports.get(path);
        if (!port) throw new Error("Missing navigation request");
        await act(() => postGuestReply(port, result));
      };

      await act(async () => clientState.frameLoadHandler?.());
      if (newPath === "/inbox") {
        reportRoute("/mail/inbox");
        onChildRouteChange.mockClear();
      }
      await renderRoute("/threads/42");
      await renderRoute(newPath);
      const superseded = "/mail/threads/42";
      const latest = `/mail${newPath}`;
      expect([...ports.keys()]).toEqual([superseded]);
      if (outcome === "accepted" && newPath !== "/inbox") {
        reportRoute(superseded);
      }
      await reply(
        superseded,
        outcome === "accepted"
          ? { result: { path: superseded } }
          : { error: "View unavailable" },
      );

      await vi.waitFor(() =>
        expect([...ports.keys()]).toEqual([superseded, latest]),
      );
      reportRoute(latest);
      await reply(latest, { result: { path: latest } });
      expect(onChildRouteChange.mock.calls).toEqual([
        [
          `/apps/workspace%2Fmail?__workspace_app_path=${encodeURIComponent(newPath)}`,
        ],
      ]);
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(clientState.legacyMutateAsync).toHaveBeenCalledTimes(1);
    },
  );

  it("opens the requested deep link if the mounted guest rejects in-place navigation", async () => {
    const origin = "https://mail.example.test";
    const startUrl = `${origin}/mail/inbox`;
    const fallbackUrl = `${origin}/mail/threads/42`;
    clientState.legacyMutateAsync
      .mockResolvedValueOnce({ startUrl })
      .mockResolvedValueOnce({ startUrl: fallbackUrl });
    clientState.suppressFrameLoad = true;
    const app = {
      id: "workspace/mail",
      name: "Mail",
      path: "/mail",
      url: `${origin}/mail`,
    };

    await act(async () => {
      root.render(<WorkspaceAppFrame app={app} embedPath="/inbox" />);
    });
    const iframe = container.querySelector("iframe");
    if (!iframe || !iframe.contentWindow) throw new Error("Missing app frame");
    vi.spyOn(iframe.contentWindow, "postMessage").mockImplementation(
      (message, _origin, transfer) => {
        if (message?.type !== "agentNative.viewRequest") return;
        const [port] = transfer as MessagePort[];
        port.postMessage({ error: "View unavailable" });
        port.close();
      },
    );
    await act(async () => clientState.frameLoadHandler?.());
    await act(async () => {
      root.render(<WorkspaceAppFrame app={app} embedPath="/threads/42" />);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
          app: "workspace/mail",
          path: "/threads/42",
          chrome: "minimal",
        }),
      );
    });
    expect(container.querySelector("iframe")).not.toBe(iframe);
    expect(
      container
        .querySelector("[data-chat-first-app-embed-url]")
        ?.getAttribute("data-chat-first-app-embed-url"),
    ).toBe(fallbackUrl);
  });

  it("reports trusted child routes to the standalone Dispatch host", async () => {
    clientState.legacyMutateAsync.mockResolvedValue({
      startUrl: "https://design.example.test/_agent-native/embed",
    });
    clientState.suppressFrameLoad = true;
    const onChildRouteChange = vi.fn();

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "design",
            name: "Design",
            path: "/",
            url: "https://design.example.test",
          }}
          onChildRouteChange={onChildRouteChange}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const iframe = container.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe).not.toBeNull();
    if (!iframe) throw new Error("Workspace app iframe was not rendered");

    const frameWindow = iframe.contentWindow;
    expect(frameWindow).not.toBeNull();
    if (!frameWindow) throw new Error("Workspace app frame window is missing");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:workspace-app-route",
            path: "/foobar?mode=edit#canvas",
          },
          origin: "https://design.example.test",
          source: frameWindow,
        }),
      );
      await Promise.resolve();
    });

    expect(onChildRouteChange).toHaveBeenCalledWith(
      "/apps/design?__workspace_app_path=%2Ffoobar%3Fmode%3Dedit%23canvas",
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:workspace-app-route",
            path: "/ignored",
          },
          origin: "https://evil.example.test",
          source: frameWindow,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:workspace-app-route",
            path: "/ignored",
          },
          origin: "https://design.example.test",
          source: {} as Window,
        }),
      );
      await Promise.resolve();
    });

    expect(onChildRouteChange).toHaveBeenCalledTimes(1);
  });

  it("relays only authenticated cross-origin frame chat submits", async () => {
    clientState.legacyMutateAsync.mockResolvedValue({
      startUrl: "https://design.example.test/_agent-native/embed",
    });
    clientState.suppressFrameLoad = true;

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "design",
            name: "Design",
            path: "/",
            url: "https://design.example.test",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const iframe = container.querySelector<HTMLIFrameElement>("iframe");
    if (!iframe?.contentWindow) throw new Error("Workspace app frame missing");
    const frameWindow = iframe.contentWindow;
    const postMessage = vi
      .spyOn(frameWindow, "postMessage")
      .mockImplementation(() => {});
    const submitData = {
      type: "agentNative.submitChat",
      data: {
        submitMessageId: "handoff-1",
        confirmParentFrame: true,
        submit: true,
        message: "Review this design",
        context: "Canvas selection",
      },
    };

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: submitData,
          origin: "https://design.example.test",
          source: frameWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.sendToAgentChatAndConfirm).toHaveBeenCalledWith(
      {
        message: "Review this design",
        context: "Canvas selection",
        chatTarget: "local",
        openSidebar: true,
        submit: true,
      },
      { submitMessageId: "handoff-1" },
    );
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "agentNative.submitChatResult",
        data: { submitMessageId: "handoff-1", delivered: true },
      },
      "https://design.example.test",
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: {
              submitMessageId: "large-context",
              confirmParentFrame: true,
              submit: true,
              message: "Review this design",
              context: "x".repeat(600_000),
            },
          },
          origin: "https://design.example.test",
          source: frameWindow,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clientState.sendToAgentChatAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ context: "x".repeat(600_000) }),
      { submitMessageId: "large-context" },
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: {
              submitMessageId: "invalid-context",
              confirmParentFrame: true,
              submit: true,
              message: "Review this design",
              context: "x".repeat(700_001),
            },
          },
          origin: "https://design.example.test",
          source: frameWindow,
        }),
      );
    });
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: "agentNative.submitChatResult",
        data: {
          submitMessageId: "invalid-context",
          delivered: false,
          reason: "invalid-payload",
        },
      },
      "https://design.example.test",
    );

    clientState.sendToAgentChatAndConfirm.mockClear();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: {
              submitMessageId: "ordinary-submit",
              submit: true,
              message: "This should stay in the child",
            },
          },
          origin: "https://design.example.test",
          source: frameWindow,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            ...submitData,
            data: { ...submitData.data, submit: false },
          },
          origin: "https://design.example.test",
          source: frameWindow,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            ...submitData,
            data: { ...submitData.data, submitMessageId: "wrong-origin" },
          },
          origin: "https://evil.example.test",
          source: frameWindow,
        }),
      );
      await Promise.resolve();
    });
    expect(clientState.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
  });

  it("seeds a standalone iframe from its initial Dispatch route", async () => {
    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{ id: "design", name: "Design", path: "/design" }}
          initialPath="/foobar?mode=edit#canvas"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "design",
      path: "/foobar?mode=edit#canvas",
      chrome: "minimal",
    });
  });

  it("clears the embed error after a direct fallback iframe loads", async () => {
    clientState.legacyMutateError = new Error("Restore request failed");
    clientState.legacyErrorMutateAsync.mockRejectedValue(
      clientState.legacyMutateError,
    );
    clientState.suppressFrameLoad = true;

    await act(async () => {
      root.render(
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const iframe = container.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe).not.toBeNull();
    expect(
      container
        .querySelector("[data-chat-first-app-error]")
        ?.getAttribute("data-chat-first-app-error"),
    ).toBe("Restore request failed");

    if (!iframe) throw new Error("Workspace app iframe was not rendered");
    expect(clientState.frameLoadHandler).not.toBeNull();

    await act(async () => {
      clientState.frameLoadHandler?.();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-chat-first-app-error]")
        ?.getAttribute("data-chat-first-app-error"),
    ).toBe("");
  });

  it("does not expose a child login page when the workspace SSO exchange fails", async () => {
    clientState.workspaceSsoEnabled = true;
    clientState.workspaceSsoMutateAsync.mockRejectedValue(
      new Error("Workspace SSO is temporarily unavailable"),
    );

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "mail",
            name: "Mail",
            path: "/mail",
            url: "https://mail.agent-native.com",
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(
      container
        .querySelector("[data-chat-first-app-error]")
        ?.getAttribute("data-chat-first-app-error"),
    ).toBe("Workspace SSO is temporarily unavailable");
  });

  it("keeps a normal iframe app inline", async () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    await act(async () => {
      root.render(
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(topWindow.location.href).toBe("");
    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "mail",
      path: "/mail/home",
      chrome: "minimal",
    });
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("opens the app in the top window for a native desktop host", async () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    const expectedUrl = new URL("/mail/inbox", window.location.href).href;
    clientState.clientSurface = "electron";
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{
            id: "mail",
            name: "Mail",
            path: "/mail",
            homePath: "/inbox",
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(topWindow.location.href).toBe(expectedUrl);
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("falls back to the embedded app when top-window navigation is blocked", async () => {
    const navigateToTopWindow = vi.fn(() => false);
    clientState.inBuilderFrame = true;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{ id: "mail", name: "Mail", path: "/mail" }}
          navigateToTopWindow={navigateToTopWindow}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigateToTopWindow).toHaveBeenCalledWith("/mail/home");
    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "mail",
      path: "/mail/home",
      chrome: "minimal",
    });
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("preserves a chat-first deep route in the top window when embedded", async () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    const embedPath = "/emails?status=failed#latest";
    const expectedUrl = new URL(
      "/mail/emails?status=failed#latest",
      window.location.href,
    ).href;
    clientState.inBuilderFrame = true;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    await act(async () => {
      root.render(
        <WorkspaceAppFrame
          app={{ id: "mail", name: "Mail", path: "/mail" }}
          embedPath={embedPath}
        />,
      );
      await Promise.resolve();
    });

    expect(topWindow.location.href).toBe(expectedUrl);
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("opens the app in the top window for a Builder webview", async () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    const expectedUrl = new URL("/mail/home", window.location.href).href;
    clientState.inBuilderFrame = true;
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    await act(async () => {
      root.render(
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
      );
      await Promise.resolve();
    });

    expect(topWindow.location.href).toBe(expectedUrl);
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("evicts the oldest inactive app after reaching the keep-alive limit", async () => {
    await act(async () => {
      root.render(<WorkspaceAppKeepAlive activeAppId="mail" />);
      await Promise.resolve();
    });

    for (const activeAppId of ["calendar", "documents", "settings"]) {
      await act(async () => {
        root.render(<WorkspaceAppKeepAlive activeAppId={activeAppId} />);
        await Promise.resolve();
      });
    }

    expect(
      container.querySelector(
        '[data-dispatch-workspace-app-cache-entry="mail"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-dispatch-workspace-app-cache-entry="calendar"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-dispatch-workspace-app-cache-entry="documents"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-dispatch-workspace-app-cache-entry="settings"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelectorAll("[data-dispatch-workspace-app-cache-entry]"),
    ).toHaveLength(3);
    expect(container.querySelectorAll("iframe")).toHaveLength(3);
  });

  it("keeps a same-origin app's deep route through the host, not just the frame", async () => {
    clientState.workspaceApps = [
      {
        id: "docs",
        name: "Docs",
        path: "/docs",
        homePath: "/home",
        url: `${window.location.origin}/dispatch/apps/docs`,
        status: "ready",
      },
    ];
    await act(async () => {
      root.render(
        <WorkspaceAppHost
          appId="docs"
          initialPath="/settings/integrations/notion"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
    expect(
      container
        .querySelector("[data-chat-first-app-embed-url]")
        ?.getAttribute("data-chat-first-app-embed-url"),
    ).toBe("/docs/settings/integrations/notion");
  });

  it("gives the kept-alive pane the deep route it is showing", async () => {
    clientState.workspaceApps = [
      {
        id: "docs",
        name: "Docs",
        path: "/docs",
        homePath: "/home",
        url: `${window.location.origin}/dispatch/apps/docs`,
        status: "ready",
      },
    ];
    await act(async () => {
      root.render(
        <WorkspaceAppKeepAlive
          activeAppId="docs"
          initialPath="/settings/integrations/notion"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector("[data-chat-first-app-embed-url]")
        ?.getAttribute("data-chat-first-app-embed-url"),
    ).toBe("/docs/settings/integrations/notion");
  });

  it("keeps a neighbour's route when another app becomes active", async () => {
    clientState.workspaceApps = [
      {
        id: "docs",
        name: "Docs",
        path: "/docs",
        homePath: "/home",
        url: `${window.location.origin}/dispatch/apps/docs`,
        status: "ready",
      },
      {
        id: "mail",
        name: "Mail",
        path: "/mail",
        homePath: "/inbox",
        url: `${window.location.origin}/dispatch/apps/mail`,
        status: "ready",
      },
    ];
    await act(async () => {
      root.render(
        <WorkspaceAppKeepAlive
          activeAppId="docs"
          initialPath="/settings/integrations/notion"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <WorkspaceAppKeepAlive activeAppId="mail" initialPath="/threads/42" />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const urls = Array.from(
      container.querySelectorAll("[data-dispatch-workspace-app-cache-entry]"),
    ).map((entry) =>
      [
        entry.getAttribute("data-dispatch-workspace-app-cache-entry"),
        entry
          .querySelector("[data-chat-first-app-embed-url]")
          ?.getAttribute("data-chat-first-app-embed-url"),
      ].join("="),
    );
    expect(urls).toContain("docs=/docs/settings/integrations/notion");
    expect(urls).toContain("mail=/mail/threads/42");
  });
});
