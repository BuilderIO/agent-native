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
    frameLoadHandler: null as (() => void) | null,
    suppressFrameLoad: false,
    theme: "dark" as "dark" | "light",
    workspaceSsoEnabled: false,
    workspaceSsoMutateAsync,
  };
});

vi.mock("@agent-native/core/client/chat-first", () => ({
  CHAT_FIRST_DEFAULT_APP_IDS: [
    "content",
    "design",
    "mail",
    "calendar",
    "clips",
  ],
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
  defaultChatFirstCopy: (key: string) => key,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => clientState.workspaceSsoEnabled,
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

import { WorkspaceAppFrame, WorkspaceAppKeepAlive } from "./workspace-app-host";

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
    clientState.legacyMutateAsync.mockClear();
    clientState.legacyMutateError = null;
    clientState.legacyErrorMutateAsync.mockReset();
    clientState.frameLoadHandler = null;
    clientState.suppressFrameLoad = false;
    clientState.workspaceSsoMutateAsync.mockClear();
    clientState.theme = "dark";
    clientState.workspaceSsoEnabled = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
    expect(
      clientState.actionQueryParams.find(
        (query) => query.name === "list-workspace-apps",
      )?.params,
    ).toEqual({ includeAgentCards: false, includeArchived: true });
    expect(
      clientState.actionQueryOptions.find((query) => query.name === "list_apps")
        ?.options?.enabled,
    ).toBe(false);
  });

  it("resolves a granted external app instead of showing app not found", async () => {
    await act(async () => {
      root.render(
        <WorkspaceAppKeepAlive activeAppId="analytics.agent-native.com" />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector(
        '[data-dispatch-workspace-app-cache-entry="analytics.agent-native.com"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-chat-first-app-status="ready"]'),
    ).not.toBeNull();
    expect(clientState.legacyMutateAsync).toHaveBeenCalledWith({
      app: "analytics.agent-native.com",
      url: "https://analytics.agent-native.com",
      chrome: "minimal",
    });
    expect(
      clientState.actionQueryOptions.find((query) => query.name === "list_apps")
        ?.options?.enabled,
    ).toBe(true);
  });

  it("does not resolve archived workspace apps for direct routes", async () => {
    clientState.workspaceApps = [
      {
        id: "hidden-app",
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
          <WorkspaceAppKeepAlive activeAppId="hidden-app" />
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
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientState.workspaceSsoMutateAsync).toHaveBeenCalledWith({
      app: "mail",
      path: "/mail",
      chrome: "minimal",
    });
    expect(clientState.legacyMutateAsync).not.toHaveBeenCalled();
  });

  it("sends the parent theme on iframe load and when the parent changes", async () => {
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

    expect(postMessage).toHaveBeenCalledWith(
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
        <WorkspaceAppFrame app={{ id: "mail", name: "Mail", path: "/mail" }} />,
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
});
