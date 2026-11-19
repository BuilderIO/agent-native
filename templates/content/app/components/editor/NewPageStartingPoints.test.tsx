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
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(NewPageStartingPoints, {
          documentId: "doc-1",
          title: props.title ?? "",
          onImport: props.onImport,
        }),
      );
    });
    const line = container.querySelector("[data-new-page-starting-points]");
    const buttons = [...container.querySelectorAll("button")];
    return { line, buttons };
  }

  it("shows one sentence whose two offers are buttons", () => {
    const onImport = vi.fn();
    const { line, buttons } = render({ onImport });

    expect(line?.textContent).toBe(
      "Start writing, draft it with the agent, or import Markdown",
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      "draft it with the agent",
      "import Markdown",
    ]);

    act(() => buttons[1]!.click());
    expect(onImport).toHaveBeenCalledOnce();
    expect(sendToAgentChat).not.toHaveBeenCalled();
  });

  it("opens the agent with the page attached and a prompt to finish", () => {
    const { buttons } = render({ title: "  Launch plan ", onImport: vi.fn() });

    act(() => buttons[0]!.click());

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
    const { line, buttons } = render();

    expect(line?.textContent).toBe("Start writing, or draft it with the agent");
    expect(buttons).toHaveLength(1);

    act(() => buttons[0]!.click());
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
