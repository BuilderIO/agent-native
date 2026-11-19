// @vitest-environment happy-dom

import { createRequire } from "node:module";

import type { AppConfig } from "@agent-native/shared-app-config";
import { act, createElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";

const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (element: Element) => {
    render: (node: ReactNode) => void;
    unmount: () => void;
  };
};
const openURL = vi.hoisted(() => vi.fn(async () => true));
const push = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ id: "", path: "", source: "" }));
const appState = vi.hoisted(() => ({
  apps: [
    {
      id: "chat",
      name: "Chat",
      url: "https://example.test/workspace",
      enabled: true,
      isBuiltIn: true,
      mode: "dev",
    },
  ] as AppConfig[],
  workspace: { enabled: false, apps: [] as AppConfig[], loading: false },
}));
vi.mock("@/lib/navigation", () => ({ useMobileNavigation: () => ({ push }) }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => routeParams,
}));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/lib/session-token-store", () => ({ SESSION_TOKEN_KEY: "session" }));
vi.mock("@/lib/mobile-colors", () => ({
  useMobileThemeColors: () => ({ background: "white", foreground: "black" }),
}));
vi.mock("@/components/AppWebView", () => ({
  default: ({
    url,
    workspaceAppId,
  }: {
    url: string;
    workspaceAppId?: string;
  }) =>
    createElement("div", {
      "data-url": url,
      "data-workspace-id": workspaceAppId,
    }),
}));
vi.mock("@/lib/use-apps", () => ({
  useApps: () => ({ apps: appState.apps, loading: false, error: null }),
}));
vi.mock("@/lib/workspace-apps", () => ({
  useWorkspaceApps: () => appState.workspace,
}));
vi.mock("react-native", () => ({
  Linking: { openURL },
  Platform: { select: () => "monospace" },
  ActivityIndicator: () => null,
  TouchableOpacity: ({ children }: { children?: ReactNode }) => children,
  View: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  Text: ({
    children,
    onPress,
  }: {
    children?: ReactNode;
    onPress?: () => void;
  }) => createElement("span", { onClick: onPress }, children),
}));
vi.mock("./StreamingFade", () => ({
  FadeInStaggeredIfStreaming: ({ children }: { children?: ReactNode }) =>
    children,
  TextFadeInStaggeredIfStreaming: ({ children }: { children?: ReactNode }) =>
    children,
}));
import AppScreen from "../../app/app/[id]";
import {
  AppPanelLinkContext,
  AppPanelLinkProvider,
} from "./AppPanelLinkContext";
import { InlineText, MarkdownText } from "./MarkdownText";

function findSpan(container: Element, text: string) {
  return Array.from(container.querySelectorAll("span")).find(
    (span) => span.textContent === text,
  );
}

it("sends tapped markdown and plain links to the panel resolver", async () => {
  const onLink = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      createElement(
        AppPanelLinkContext.Provider,
        { value: onLink },
        createElement(MarkdownText, {
          text: "[Open mail](https://mail.example.test/inbox) or https://example.org",
        }),
      ),
    ),
  );
  const markdownLink = findSpan(container, "Open mail");
  const plainLink = findSpan(container, "https://example.org");
  if (!markdownLink || !plainLink) throw new Error("expected both links");
  await act(() => markdownLink.click());
  await act(() => plainLink.click());
  expect(onLink.mock.calls).toEqual([
    ["https://mail.example.test/inbox"],
    ["https://example.org"],
  ]);
  expect(openURL).not.toHaveBeenCalled();
  await act(() => root.unmount());
});

it("opens app-local automation replies and root links against the active chat app", async () => {
  openURL.mockClear();
  push.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      createElement(
        AppPanelLinkProvider,
        { baseUrl: "https://example.test/workspace" },
        createElement(MarkdownText, {
          text: "[Automation](/settings/automations?automationId=resource-1#agent-native-app-local) and [Root](/settings/automations?automationId=root) and [External](https://elsewhere.example/path)",
        }),
      ),
    ),
  );
  const automation = findSpan(container, "Automation");
  const rootLink = findSpan(container, "Root");
  const external = findSpan(container, "External");
  if (!automation || !rootLink || !external) throw new Error("expected links");
  await act(() => automation.click());
  await act(() => rootLink.click());
  await act(() => external.click());
  expect(push).toHaveBeenCalledWith(
    `/app/chat?path=${encodeURIComponent("/workspace/settings/automations?automationId=resource-1")}`,
  );
  expect(openURL.mock.calls).toEqual([
    ["https://example.test/settings/automations?automationId=root"],
    ["https://elsewhere.example/path"],
  ]);
  await act(() => root.unmount());
});

it("rejects escaped and unregistered app-local links without opening a browser", async () => {
  openURL.mockClear();
  push.mockClear();
  const onUnavailable = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (baseUrl: string, text: string) =>
    root.render(
      createElement(
        AppPanelLinkProvider,
        { baseUrl, onUnavailable },
        createElement(MarkdownText, { text }),
      ),
    );
  await act(() =>
    render(
      "https://example.test/workspace",
      "See [Escape](/%2e%2e/outside#agent-native-app-local)",
    ),
  );
  const escape = findSpan(container, "Escape");
  if (!escape) throw new Error("expected link");
  await act(() => escape.click());
  await act(() =>
    render(
      "https://unknown.example/workspace",
      "See [Unknown](/settings#agent-native-app-local)",
    ),
  );
  const unknown = findSpan(container, "Unknown");
  if (!unknown) throw new Error("expected link");
  await act(() => unknown.click());
  expect(onUnavailable).toHaveBeenCalledTimes(2);
  expect(push).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
  await act(() => root.unmount());
});

it("opens the registration matching the chat origin even when app ids collide", async () => {
  openURL.mockClear();
  push.mockClear();
  const onUnavailable = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  appState.workspace = {
    enabled: true,
    loading: false,
    apps: [
      { ...appState.apps[0]!, url: "https://example.test/workspace/second" },
    ],
  };
  try {
    const render = (baseUrl: string) =>
      root.render(
        createElement(
          AppPanelLinkProvider,
          { baseUrl, onUnavailable },
          createElement(MarkdownText, {
            text: "See [Open](/settings/automations?automationId=second#agent-native-app-local)",
          }),
        ),
      );
    await act(() => render("https://example.test/workspace/second"));
    const link = findSpan(container, "Open");
    if (!link) throw new Error("expected link");
    await act(() => link.click());
    expect(push).toHaveBeenCalledWith(
      `/app/chat?path=${encodeURIComponent("/workspace/second/settings/automations?automationId=second")}`,
    );
    await act(() => render("https://example.test/workspace"));
    const replaced = findSpan(container, "Open");
    if (!replaced) throw new Error("expected link");
    await act(() => replaced.click());
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2);
    const destinationPath = push.mock.calls[1]?.[0];
    if (typeof destinationPath !== "string")
      throw new Error("expected destination");
    const destination = new URL(destinationPath, "https://mobile.example");
    routeParams.id = "chat";
    routeParams.path = destination.searchParams.get("path") ?? "";
    routeParams.source = destination.searchParams.get("source") ?? "";
    await act(() => root.render(createElement(AppScreen)));
    const webview = container.querySelector("[data-url]");
    expect(webview?.getAttribute("data-url")).toBe(
      "https://example.test/workspace/settings/automations?automationId=second",
    );
    expect(webview?.getAttribute("data-workspace-id")).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  } finally {
    appState.workspace = { enabled: false, apps: [], loading: false };
    await act(() => root.unmount());
  }
});

it("preserves plain user message formatting while making links tappable", async () => {
  const onLink = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      createElement(
        AppPanelLinkContext.Provider,
        { value: onLink },
        createElement(InlineText, {
          linksOnly: true,
          text: "**keep stars** https://example.org [Root](/settings/automations?automationId=root)",
        }),
      ),
    ),
  );
  expect(container.textContent).toBe("**keep stars** https://example.org Root");
  const link = findSpan(container, "https://example.org");
  const rootLink = findSpan(container, "Root");
  if (!link || !rootLink) throw new Error("expected both links");
  await act(() => link.click());
  await act(() => rootLink.click());
  expect(onLink.mock.calls).toEqual([
    ["https://example.org"],
    ["/settings/automations?automationId=root"],
  ]);
  await act(() => root.unmount());
});

it("does not treat protocol-relative or backslash paths as app links", async () => {
  const onLink = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      createElement(
        AppPanelLinkContext.Provider,
        { value: onLink },
        createElement(MarkdownText, {
          text: "[External](//evil.example/path) [Backslash](/\\evil.example/path)",
        }),
      ),
    ),
  );
  expect(container.textContent).toBe(
    "[External](//evil.example/path) [Backslash](/\\evil.example/path)",
  );
  expect(onLink).not.toHaveBeenCalled();
  await act(() => root.unmount());
});

it("opens links with the system handler when no panel resolver is mounted", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      createElement(InlineText, { text: "See https://example.org/docs" }),
    ),
  );
  const link = findSpan(container, "https://example.org/docs");
  if (!link) throw new Error("expected a link");
  await act(() => link.click());
  expect(openURL).toHaveBeenCalledWith("https://example.org/docs");
  await act(() => root.unmount());
});
