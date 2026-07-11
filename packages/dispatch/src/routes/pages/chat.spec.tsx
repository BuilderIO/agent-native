// @vitest-environment happy-dom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatRoute from "./chat";

const clientState = vi.hoisted(() => ({
  surfaceProps: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client", () => ({
  AgentChatSurface: (props: Record<string, unknown>) => {
    clientState.surfaceProps = props;
    return <>{props.composerSlot as ReactNode}</>;
  },
  appBasePath: () => "",
  appPath: (path: string) => path,
  isInBuilderFrame: () => false,
  markAgentChatHomeHandoff: vi.fn(),
  sendToAgentChat: vi.fn(),
  useT: () => (key: string, values?: { defaultValue?: string }) =>
    values?.defaultValue ?? key,
}));

describe("Dispatch ChatRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.surfaceProps = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
    expect(container.textContent).not.toContain("Chat across your apps");
  });
});
