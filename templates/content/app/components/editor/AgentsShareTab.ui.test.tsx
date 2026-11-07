// @vitest-environment happy-dom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/sharing", () => ({
  AgentShareSection: ({ label }: { label: string }) =>
    createElement("div", null, label),
}));

import { AgentsShareTab } from "./AgentsShareTab";

describe("AgentsShareTab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(
    props: Partial<ComponentProps<typeof AgentsShareTab>> = {},
  ) {
    await act(async () => {
      root.render(
        createElement(AgentsShareTab, {
          documentId: "page-1",
          level: "edit",
          onLevelChange: vi.fn(),
          pending: false,
          canManage: true,
          onCopyPrompt: vi.fn(async () => true),
          onOpenAgent: vi.fn(),
          onOpenMcpSettings: vi.fn(),
          ...props,
        }),
      );
    });
  }

  function levelMenu() {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.toolbar.agentLevelMenuLabel"]',
    )!;
  }

  it("shows the level and what it means", async () => {
    await show({ level: "comment" });

    expect(levelMenu().textContent).toBe("agentChat.share.canComment");
    expect(container.textContent).toContain(
      "editor.toolbar.agentLevelCommentDescription",
    );
    expect(container.textContent).toContain("editor.toolbar.agentLevelLimit");
  });

  it("lets someone who manages the page change the level from the keyboard", async () => {
    const onLevelChange = vi.fn();
    await show({ onLevelChange });

    await act(async () =>
      levelMenu().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
    expect(items[1].textContent).toContain("editor.toolbar.agentLevelDefault");

    await act(async () => items[0].click());

    expect(onLevelChange).toHaveBeenCalledWith("comment");
  });

  it("shows the level read-only to someone who can't manage the page", async () => {
    await show({ canManage: false, level: "comment" });

    expect(levelMenu().disabled).toBe(true);
    expect(levelMenu().textContent).toBe("agentChat.share.canComment");
    expect(container.textContent).toContain(
      "editor.toolbar.agentLevelManagersOnly",
    );
    expect(container.textContent).not.toContain(
      "editor.toolbar.agentLevelLimit",
    );
  });

  it("holds the level while a change is saving", async () => {
    await show({ pending: true });

    expect(levelMenu().disabled).toBe(true);
  });

  it("keeps every way of sending the page to an agent", async () => {
    const onCopyPrompt = vi.fn(async () => true);
    const onOpenMcpSettings = vi.fn();
    await show({ onCopyPrompt, onOpenMcpSettings });

    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) =>
          candidate.textContent?.includes(label) ||
          candidate.getAttribute("aria-label") === label,
      )!;
    await act(async () => button("agentChat.share.copyAgentPrompt").click());
    await act(async () => button("editor.toolbar.connectAgentOverMcp").click());

    expect(onCopyPrompt).toHaveBeenCalledTimes(1);
    expect(onOpenMcpSettings).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("agentChat.share.copyAgentLink");
  });
});
