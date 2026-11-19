// @vitest-environment happy-dom

import { createRequire } from "node:module";

import { act, createElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";

const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (element: Element) => {
    render: (node: ReactNode) => void;
    unmount: () => void;
  };
};
const openURL = vi.hoisted(() => vi.fn(async () => true));
vi.mock("react-native", () => ({
  Linking: { openURL },
  Platform: { select: () => "monospace" },
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
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() =>
    root.render(
      createElement(
        AppPanelLinkProvider,
        { baseUrl: "https://example.test/workspace" },
        createElement(MarkdownText, {
          text: "[Automation](/settings/automations?automationId=resource-1#agent-native-app-local) and [Root](/settings/automations?automationId=root)",
        }),
      ),
    ),
  );
  const automation = findSpan(container, "Automation");
  const rootLink = findSpan(container, "Root");
  if (!automation || !rootLink) throw new Error("expected both links");
  await act(() => automation.click());
  await act(() => rootLink.click());
  expect(openURL.mock.calls).toEqual([
    [
      "https://example.test/workspace/settings/automations?automationId=resource-1",
    ],
    ["https://example.test/settings/automations?automationId=root"],
  ]);
  await act(() => root.unmount());
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
