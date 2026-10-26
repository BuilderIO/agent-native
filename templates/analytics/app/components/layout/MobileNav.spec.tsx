// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentToggleButton: () => (
    <button type="button" aria-label="Toggle agent" data-agent-toggle="" />
  ),
}));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));

const { MobileNav } = await import("./MobileNav");

describe("MobileNav", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(showNewChat: boolean) {
    act(() => {
      root.render(
        <MemoryRouter>
          <MobileNav showNewChat={showNewChat} />
        </MemoryRouter>,
      );
    });
  }

  it("opens the agent from the phone bar outside Ask", () => {
    render(false);
    expect(container.querySelector("[data-agent-toggle]")).not.toBeNull();
  });

  it("offers a new chat instead on Ask, where the chat is the page", () => {
    render(true);
    expect(container.querySelector("[data-agent-toggle]")).toBeNull();
    expect(
      container.querySelector('button[aria-label="chat.newChat"]'),
    ).not.toBeNull();
  });
});
