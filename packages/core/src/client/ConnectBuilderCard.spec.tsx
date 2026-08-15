// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectBuilderCard } from "./ConnectBuilderCard.js";

const mocks = vi.hoisted(() => ({
  useBuilderConnectFlow: vi.fn(),
  start: vi.fn(),
  writeClipboardText: vi.fn(),
}));

vi.mock("./settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));
vi.mock("./clipboard.js", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));

describe("ConnectBuilderCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalLocation: Location;

  function setLocation(href: string) {
    const url = new URL(href);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: url.href,
        origin: url.origin,
        hostname: url.hostname,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        reload: vi.fn(),
        assign: vi.fn(),
        replace: vi.fn(),
      },
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    originalLocation = window.location;
    setLocation("https://agent-native.test/");
    mocks.writeClipboardText.mockResolvedValue(true);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      configured: true,
      builderEnabled: false,
      orgName: "Builder space",
      envManaged: false,
      connecting: false,
      error: null,
      start: mocks.start,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    delete (window as unknown as Record<string, unknown>).electronAPI;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers an external coding-agent handoff instead of a waitlist", async () => {
    setLocation("http://localhost:8080/");

    act(() => {
      root.render(
        <ConnectBuilderCard
          configured
          builderEnabled={false}
          connectUrl="https://builder.io/cli-auth"
          prompt="Update the dashboard layout"
        />,
      );
    });

    expect(container.textContent).toContain("This requires a code change");
    expect(container.textContent).toContain(
      "Open your coding agent in this project, then paste this request.",
    );
    expect(container.textContent).not.toContain("Claude Code");
    expect(container.textContent).not.toContain("Codex");
    expect(container.textContent).toContain("Copy prompt");
    expect(container.textContent).not.toContain("waitlist");
    expect(container.textContent).not.toContain("Download desktop app");

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Copy prompt"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(mocks.writeClipboardText).toHaveBeenCalledWith(
      "Update the dashboard layout",
    );
    expect(container.textContent).toContain("Prompt copied");
  });

  it("offers a scoped local handoff in the Electron shell", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { appConfig: {} },
    });
    let receivedPrompt = "";
    const handleLocalCodeChange = (event: Event) => {
      receivedPrompt =
        (event as CustomEvent<{ prompt?: string }>).detail?.prompt ?? "";
    };
    window.addEventListener(
      "agent-native:desktop-local-code-change",
      handleLocalCodeChange,
    );

    act(() => {
      root.render(
        <ConnectBuilderCard
          configured
          builderEnabled
          connectUrl=""
          prompt="Add keyboard shortcuts to Mail"
        />,
      );
    });

    expect(container.textContent).toContain("Do locally");
    const button = container.querySelector("[data-desktop-local-code-change]");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(receivedPrompt).toBe("Add keyboard shortcuts to Mail");
    expect(container.textContent).toContain("Preparing locally");
    window.removeEventListener(
      "agent-native:desktop-local-code-change",
      handleLocalCodeChange,
    );
  });

  it("shows a code-change fallback when Builder Cloud Agents are unavailable", () => {
    act(() => {
      root.render(
        <ConnectBuilderCard
          configured
          builderEnabled={false}
          connectUrl="https://builder.io/cli-auth"
          prompt="Update the dashboard layout"
        />,
      );
    });

    expect(container.textContent).toContain("This requires a code change");
    expect(container.textContent).toContain(
      "Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.",
    );
    expect(container.textContent).not.toContain(
      "Builder Cloud Agents coming soon",
    );
    expect(container.textContent).not.toContain("Send to Builder");
  });

  it("keeps the server-rendered branch CTA when status refresh is unavailable", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: false,
      configured: false,
      builderEnabled: false,
      orgName: null,
      envManaged: false,
      connecting: false,
      error: null,
      start: mocks.start,
    });

    act(() => {
      root.render(
        <ConnectBuilderCard
          configured
          builderEnabled
          connectUrl=""
          prompt="Update the dashboard layout"
        />,
      );
    });

    expect(container.textContent).toContain("Send this to Builder");
    expect(container.textContent).toContain("Send to Builder");
  });

  it("sends the background-coding use case when joining the waitlist", async () => {
    setLocation("https://agent-native.test/");
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await act(async () => {
      root.render(
        <ConnectBuilderCard
          configured
          builderEnabled={false}
          connectUrl="https://builder.io/cli-auth"
          orgName="Builder space"
          prompt="Update the dashboard layout"
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Join the waitlist"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(requests).toHaveLength(1);
    const payload = JSON.parse(String(requests[0]?.init?.body));
    expect(payload).toMatchObject({
      prompt: "Update the dashboard layout",
      orgName: "Builder space",
      source: "connect_builder_card",
      useCase: "builder_agent_background_coding",
    });
  });
});
