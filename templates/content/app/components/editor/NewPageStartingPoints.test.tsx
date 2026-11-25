// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChat = vi.hoisted(() => vi.fn());
const messages = vi.hoisted(() => ({
  current: {} as Record<string, string>,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    (messages.current[key] ?? key).replace(
      /\{\{(\w+)\}\}/g,
      (_, name: string) => vars?.[name] ?? "",
    ),
}));

import { NewPageStartingPoints } from "./NewPageStartingPoints";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ENGLISH = {
  "editor.newPageLine": "Start writing, {{draft}}, or {{import}}",
  "editor.newPageLineWithoutImport": "Start writing, or {{draft}}",
  "editor.newPageLineDraft": "draft it with the agent",
  "editor.newPageLineImport": "import Markdown",
  "editor.newPageDraftPrompt": "Draft this page about ",
  "editor.newPageDraftPromptTitled": "Draft this page about {{title}}",
  "editor.newPageAgentContextLabel": "This page",
};

describe("NewPageStartingPoints", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    messages.current = ENGLISH;
    sendToAgentChat.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(props: { title?: string; onImport?: () => void } = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    act(() => {
      mounted.render(
        createElement(NewPageStartingPoints, {
          documentId: "doc-1",
          title: props.title ?? "",
          onImport: props.onImport,
        }),
      );
    });
    const line = container.querySelector("[data-new-page-starting-points]");
    const buttons = [...container.querySelectorAll("button")];
    const press = (index: number) => {
      const button = buttons.find((_, position) => position === index);
      if (!button) throw new Error(`no button ${index}`);
      act(() => button.click());
    };
    return { line, buttons, press };
  }

  it("shows one sentence whose two offers are buttons", () => {
    const onImport = vi.fn();
    const { line, buttons, press } = render({ onImport });

    expect(line?.textContent).toBe(
      "Start writing, draft it with the agent, or import Markdown",
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      "draft it with the agent",
      "import Markdown",
    ]);

    press(1);
    expect(onImport).toHaveBeenCalledOnce();
    expect(sendToAgentChat).not.toHaveBeenCalled();
  });

  it("opens the agent with the page attached and a prompt to finish", () => {
    const { press } = render({ title: "  Launch plan ", onImport: vi.fn() });

    press(0);

    expect(sendToAgentChat).toHaveBeenCalledOnce();
    const request = sendToAgentChat.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      submit: false,
      openSidebar: true,
      message: "Draft this page about Launch plan",
      contextLabel: "Launch plan",
    });
    expect(request.context).toContain("Document ID: doc-1");
  });

  it("drops the import offer when the page can't import", () => {
    const { line, buttons, press } = render();

    expect(line?.textContent).toBe("Start writing, or draft it with the agent");
    expect(buttons).toHaveLength(1);

    press(0);
    expect(sendToAgentChat.mock.calls[0]?.[0]).toMatchObject({
      message: "Draft this page about ",
      contextLabel: "This page",
    });
  });

  it("keeps a translation's word order around the buttons", () => {
    messages.current = {
      ...ENGLISH,
      "editor.newPageLine": "{{import}} or {{draft}}, or start writing",
    };
    const { line, buttons } = render({ onImport: vi.fn() });

    expect(line?.textContent).toBe(
      "import Markdown or draft it with the agent, or start writing",
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      "import Markdown",
      "draft it with the agent",
    ]);
  });
});
