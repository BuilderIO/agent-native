// @vitest-environment happy-dom

import { act, createContext, createElement, type ReactNode } from "react";
// The mobile app already depends on react-dom at runtime, but not its types.
// @ts-expect-error This test only needs the small React DOM root surface below.
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Root = { render(node: ReactNode): void; unmount(): void };

function nativeHost(tag: string) {
  return ({
    children,
    ...props
  }: Record<string, unknown> & { children?: ReactNode }) => {
    const { onPress, accessibilityLabel, accessibilityRole, ...nativeProps } =
      props;
    return createElement(
      tag,
      {
        ...nativeProps,
        ...(typeof accessibilityLabel === "string"
          ? { "aria-label": accessibilityLabel }
          : {}),
        ...(typeof accessibilityRole === "string"
          ? { role: accessibilityRole }
          : {}),
        ...(typeof onPress === "function" ? { onClick: onPress } : {}),
      },
      children,
    );
  };
}

vi.mock("react-native", async () => {
  return {
    Image: nativeHost("img"),
    Linking: { openURL: vi.fn() },
    Pressable: nativeHost("button"),
    Text: nativeHost("span"),
    View: nativeHost("div"),
  };
});

vi.mock("react-native-reanimated", async () => {
  const View = nativeHost("div");
  const transition = {
    damping: () => transition,
    duration: () => transition,
    springify: () => transition,
  };
  return { default: { View }, FadeIn: transition, FadeInDown: transition };
});
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "message.mobileInteractiveTitle"
      ? "Interactive content"
      : key === "message.mobileInteractiveDescription"
        ? "This interactive view is available in web chat, but not in native chat yet."
        : key,
}));

vi.mock("@tabler/icons-react-native", () =>
  Object.fromEntries(
    [
      "IconAlertTriangle",
      "IconCheck",
      "IconChevronDown",
      "IconChevronRight",
      "IconCopy",
      "IconDots",
      "IconExternalLink",
      "IconPlugConnected",
    ].map((name) => [name, () => null]),
  ),
);
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@/lib/mobile-colors", () => ({
  useMobileThemeColors: () => ({ mutedForeground: "#777" }),
}));
vi.mock("./MarkdownText", () => ({ MarkdownText: () => null }));
vi.mock("./ShineText", () => ({ ShineText: () => null }));
vi.mock("./StreamingFade", async () => {
  const React = await import("react");
  return { MessageContext: React.createContext({}) };
});
vi.mock("./ToolCallCard", async () => {
  const React = await import("react");
  return {
    ToolCallCard: ({ part }: { part: { toolName: string } }) =>
      React.createElement(
        "div",
        { "data-testid": "generic-tool" },
        part.toolName,
      ),
  };
});

import type { ChatMessage } from "@/lib/agent-chat/types";

import { AssistantMessage, UserMessage } from "./MessageBubbles";

describe("native assistant connection cards", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      toolName: "create_invoice",
      result: {
        connectRequired: {
          provider: "acme",
          providerLabel: "Acme",
          reason: "Acme needs to be connected first.",
          message: "Connect Acme to continue.",
          connectUrl: "https://example.test/connect",
        },
      },
      provider: "Acme",
      detail: "Acme needs to be connected first.",
    },
    {
      toolName: "connect-builder",
      result: {
        kind: "connect-builder-card",
        configured: false,
        builderEnabled: true,
        prompt: "Connect Builder.io to create this app.",
      },
      provider: "Builder.io",
      detail: "Connect Builder.io to create this app.",
    },
  ])(
    "renders $provider connection output as a native card",
    ({ toolName, result, provider, detail }) => {
      const message: ChatMessage = {
        id: "assistant-1",
        role: "assistant",
        createdAt: 0,
        parts: [
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName,
            inputText: "{}",
            status: "completed",
            resultText: JSON.stringify(result),
          },
        ],
      };

      act(() => {
        root.render(
          <AssistantMessage
            message={message}
            animateIn={false}
            showFooter={false}
            canChat
            onOpenConnections={() => {}}
            onContinueAfterConnection={() => {}}
          />,
        );
      });

      expect(container.textContent).toContain(`Connect ${provider}`);
      expect(container.textContent).toContain(detail);
      expect(
        container.querySelector(`[aria-label="Connect ${provider}"]`),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="generic-tool"]'),
      ).toBeNull();
    },
  );

  it.each([
    { kind: "MCP App", metadata: { mcpApp: { html: "<p>App</p>" } } },
    { kind: "custom chat UI", metadata: { chatUI: { renderer: "custom" } } },
  ])(
    "keeps the $kind fallback visible after completed work",
    ({ metadata }) => {
      const message: ChatMessage = {
        id: "assistant-interactive",
        role: "assistant",
        createdAt: 0,
        parts: [
          {
            type: "tool-call",
            toolCallId: "tool-search",
            toolName: "search_hidden_in_summary",
            inputText: "{}",
            status: "completed",
          },
          {
            type: "tool-call",
            toolCallId: "tool-interactive",
            toolName: "interactive_tool",
            inputText: "{}",
            status: "completed",
            ...metadata,
          },
        ],
      };

      act(() => {
        root.render(
          <AssistantMessage
            message={message}
            animateIn={false}
            showFooter={false}
            canChat
          />,
        );
      });

      expect(container.textContent).toContain("Interactive content");
      expect(container.textContent).toContain("available in web chat");
      expect(container.textContent).toContain("Worked");
      expect(container.textContent).not.toContain("search_hidden_in_summary");
    },
  );
});

describe("native user message actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("offers the message action affordance for user turns", () => {
    const message: ChatMessage = {
      id: "user-1",
      role: "user",
      createdAt: 0,
      parts: [{ type: "text", text: "Question" }],
    };
    const onActions = vi.fn();

    act(() => {
      root.render(
        <UserMessage
          message={message}
          animateIn={false}
          onActions={onActions}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Message actions"]',
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(onActions).toHaveBeenCalledWith(message);
  });
});
