// @vitest-environment happy-dom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatRoute from "./chat";

const clientState = vi.hoisted(() => ({
  surfaceProps: null as Record<string, unknown> | null,
  agents: [] as Array<{
    id: string;
    name: string;
    description: string | null;
    path: string;
    content: string;
    scope: "all" | "selected";
    updatedAt: number;
  }>,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentChatSurface: (props: Record<string, unknown>) => {
    clientState.surfaceProps = props;
    return <>{props.composerSlot as ReactNode}</>;
  },
  insertAgentComposerReference: vi.fn(),
  markAgentChatHomeHandoff: vi.fn(),
  readChatFirstMode: () => true,
  navigateWithAgentChatViewTransition: (
    navigate: (path: string) => void,
    path: string,
  ) => navigate(path),
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: clientState.agents,
    error: null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../components/layout/Layout", () => ({
  useDispatchExtensions: () => undefined,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appApiPath: (path: string) => path,
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { defaultValue?: string }) =>
    values?.defaultValue ?? key,
}));

describe("Dispatch ChatRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // ChatRoute intentionally clears navigation handoff state on a zero-delay
    // timer. Keep that timer deterministic so a busy workspace test run cannot
    // advance to the post-handoff hero render before this spec inspects the
    // transition frame.
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.surfaceProps = null;
    clientState.agents = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the centered hero layout for a direct new Chat", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps).toMatchObject({
      mode: "page",
      chatViewTransition: true,
      centerComposerWhenEmpty: true,
      composerLayoutVariant: "hero",
      composerPlaceholder: "Ask Dispatch...",
      suppressInlineOpenApp: true,
    });
    expect(container.textContent).toContain("Chat across your apps");
  });

  it("starts bottom-pinned when an Overview prompt is transitioning in", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/chat",
              state: {
                dispatchPrompt: {
                  id: "overview-prompt",
                  message: "Route this across my apps",
                  selectedModel: "auto",
                },
              },
            },
          ]}
        >
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps).not.toHaveProperty(
      "centerComposerWhenEmpty",
    );
    expect(clientState.surfaceProps).not.toHaveProperty(
      "composerLayoutVariant",
    );
    expect(clientState.surfaceProps).toHaveProperty(
      "suppressInlineOpenApp",
      true,
    );
    expect(container.textContent).not.toContain("Chat across your apps");
  });

  it("keeps an agent chat scoped and preserves the scope in thread URLs", async () => {
    clientState.agents = [
      {
        id: "agent-1",
        name: "Research Partner",
        description: "Synthesizes research",
        path: "agents/research-partner.md",
        content: "instructions",
        scope: "all",
        updatedAt: 1,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={["/chat?agent=agents/research-partner.md"]}
        >
          <ChatRoute />
        </MemoryRouter>,
      );
    });

    expect(clientState.surfaceProps).toMatchObject({
      scope: {
        type: "agent",
        id: "agent-1",
        label: "Research Partner",
      },
      storageKey: "dispatch-agent-agent-1",
      composerPlaceholder: "Ask Research Partner...",
    });
    expect(
      (
        clientState.surfaceProps?.threadUrlSync as {
          getPath: (id: string) => string;
        }
      ).getPath("thread-1"),
    ).toBe("/chat/thread-1?agent=agents%2Fresearch-partner.md");
  });
});
