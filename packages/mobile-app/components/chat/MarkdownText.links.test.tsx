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
import { AppPanelLinkContext } from "./AppPanelLinkContext";
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
          text: "**keep stars** https://example.org",
        }),
      ),
    ),
  );
  expect(container.textContent).toBe("**keep stars** https://example.org");
  const link = findSpan(container, "https://example.org");
  if (!link) throw new Error("expected a link");
  await act(() => link.click());
  expect(onLink).toHaveBeenCalledWith("https://example.org");
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
