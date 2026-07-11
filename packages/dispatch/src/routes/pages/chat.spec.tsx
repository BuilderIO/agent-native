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
    return <>{props.emptyStateAddon as ReactNode}</>;
  },
  appBasePath: () => "",
  appPath: (path: string) => path,
  markAgentChatHomeHandoff: vi.fn(),
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

  it("starts in the bottom-composer layout without the centered hero snap", async () => {
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
      composerPlaceholder: "Ask Dispatch...",
    });
    expect(clientState.surfaceProps).not.toHaveProperty(
      "centerComposerWhenEmpty",
    );
    expect(clientState.surfaceProps).not.toHaveProperty(
      "composerLayoutVariant",
    );
    expect(container.textContent).toContain("Chat across your apps");
  });
});
