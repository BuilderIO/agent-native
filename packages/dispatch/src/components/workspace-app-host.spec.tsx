// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => {
  const mutateAsync = vi.fn().mockImplementation(async () => ({
    startUrl: "about:blank",
  }));
  return { mutateAsync };
});

vi.mock("@agent-native/core/client/chat-first", () => ({
  ChatFirstAppPane: ({
    app,
    embedUrl,
    renderEmbed,
    status,
  }: {
    app: { name: string } | null;
    embedUrl?: string | null;
    renderEmbed: (target: { url: string; title?: string }) => React.ReactNode;
    status: string;
  }) => (
    <div data-chat-first-app-status={status}>
      {status === "ready" && embedUrl
        ? renderEmbed({ url: embedUrl, title: app?.name })
        : null}
    </div>
  ),
  defaultChatFirstCopy: (key: string) => key,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: clientState.mutateAsync }),
  useActionQuery: () => ({
    data: [
      { id: "mail", name: "Mail", path: "/mail", url: null, status: "ready" },
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
    ],
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { WorkspaceAppKeepAlive } from "./workspace-app-host";

describe("WorkspaceAppKeepAlive", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clientState.mutateAsync.mockClear();
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
