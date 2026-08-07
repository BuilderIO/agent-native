// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectBuilderCard } from "./ConnectBuilderCard.js";

const mocks = vi.hoisted(() => ({
  useBuilderConnectFlow: vi.fn(),
  start: vi.fn(),
  sendToAgentChat: vi.fn(),
}));

vi.mock("./settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));
vi.mock("./agent-chat.js", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
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
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends local code changes to the coding agent instead of a waitlist", () => {
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

    expect(container.textContent).toContain("Use your coding agent");
    expect(container.textContent).toContain("Send to coding agent");
    expect(container.textContent).not.toContain("waitlist");
    expect(container.textContent).not.toContain("Download desktop app");

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("Send to coding agent"),
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(mocks.sendToAgentChat).toHaveBeenCalledWith({
      message: "Update the dashboard layout",
      submit: true,
      type: "code",
      newTab: true,
    });
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
