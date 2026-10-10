// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  composerProps: null as Record<string, unknown> | null,
  rootProps: null as Record<string, unknown> | null,
  navigateWithTransition: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string>): string =>
      params ? `${key}|${Object.values(params).join("|")}|${key}:end` : key,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  navigateWithAgentChatViewTransition: state.navigateWithTransition,
}));
vi.mock("@agent-native/core/client/agentkit-chat/transport", () => ({
  createAgentNativeAgentKitTransport: () => ({ id: "home-transport" }),
}));
vi.mock("@agent-native/toolkit/app/agentkit/react/components", () => ({
  AgentKitComposer: (props: Record<string, unknown>) => {
    state.composerProps = props;
    return null;
  },
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/composer", () => ({
  CoreComposerRuntimeProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));
vi.mock("@agent-native/toolkit/app/chat/agentkit-chat/index", () => ({
  CoreAgentKitRoot: (props: Record<string, unknown>) => {
    state.rootProps = props;
    return <>{props.children as React.ReactNode}</>;
  },
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  WaveBackground: () => null,
}));
vi.mock("@agent-native/toolkit/app/shared/AgentNativeIcon", () => ({
  AgentNativeIcon: () => <svg />,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    asChild ? <>{children}</> : <button {...props}>{children}</button>,
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "home-tab" }));
vi.mock("react-router", () => ({ useNavigate: () => state.navigate }));

import HomePage from "./HomePage";

describe("HomePage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.composerProps = null;
    state.rootProps = null;
    state.navigateWithTransition.mockReset();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("embeds the chat page composer gated on a connected model", () => {
    act(() => root.render(<HomePage />));

    expect(container.querySelector("h1")?.textContent).toBe("home.title");
    expect(state.composerProps).toMatchObject({
      requireAgentEngine: true,
      placeholder: "home.composerPlaceholder",
    });
    expect(state.rootProps?.threadId).toEqual(expect.stringMatching(/^chat-/));
    expect(state.composerProps?.threadId).toBe(state.rootProps?.threadId);
  });

  it("hands the submitted prompt to the full chat page for the same thread", () => {
    act(() => root.render(<HomePage />));
    const threadId = state.rootProps?.threadId as string;

    const onSubmit = state.composerProps?.onSubmit as (text: string) => void;
    act(() => onSubmit("Call the hello action for Sam"));

    expect(state.navigateWithTransition).toHaveBeenCalledWith(
      state.navigate,
      `/chat/${threadId}`,
      { state: { initialMessage: "Call the hello action for Sam" } },
    );
  });

  it("renders file paths as code inside translated sentences", () => {
    act(() => root.render(<HomePage />));

    const codes = Array.from(container.querySelectorAll("code")).map(
      (code) => code.textContent,
    );
    expect(codes).toEqual([
      "actions/hello.ts",
      "SHOW_HOME_PAGE",
      "false",
      "app/lib/chat-paths.ts",
    ]);
  });

  it("links to the docs and community", () => {
    act(() => root.render(<HomePage />));

    const hrefs = Array.from(container.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "https://www.agent-native.com/docs/getting-started",
      "https://www.agent-native.com/docs/getting-started-actions",
      "https://www.agent-native.com/docs/getting-started-pages",
      "https://www.agent-native.com/docs/key-concepts",
      "https://github.com/BuilderIO/agent-native",
      "https://discord.gg/qm82StQ2NC",
    ]);
  });
});
