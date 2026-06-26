// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentConversationMessageView } from "./AgentConversation.js";

vi.mock("../extensions/InlineExtensionFrame.js", () => ({
  InlineExtensionFrame: ({ extensionId, extension }: any) => (
    <div
      data-testid="conversation-inline-extension"
      data-extension-id={extensionId ?? extension?.id}
    >
      {extension?.name}
    </div>
  ),
}));

describe("AgentConversationMessageView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders text and tool parts in transcript order", () => {
    act(() => {
      root.render(
        <AgentConversationMessageView
          message={{
            id: "message-1",
            role: "assistant",
            parts: [
              { id: "text-1", type: "text", text: "Before tool." },
              {
                id: "tool-1",
                type: "tool",
                tool: {
                  id: "tool-1",
                  name: "list_files",
                  state: "completed",
                  summary: "finished",
                },
              },
              { id: "text-2", type: "text", text: "After tool." },
            ],
          }}
        />,
      );
    });

    expect(container.textContent).toMatch(
      /Before tool\.\s*list files\s*finished\s*After tool\./,
    );
  });

  it("humanizes running tool names", () => {
    act(() => {
      root.render(
        <AgentConversationMessageView
          message={{
            id: "message-1",
            role: "assistant",
            parts: [
              {
                id: "tool-1",
                type: "tool",
                tool: {
                  id: "tool-1",
                  name: "generate-design",
                  state: "running",
                },
              },
            ],
          }}
        />,
      );
    });

    expect(container.textContent).toContain("generate design");
    expect(container.textContent).not.toContain("generate-design");
  });

  it("renders native inline extension tool UI", () => {
    act(() => {
      root.render(
        <AgentConversationMessageView
          message={{
            id: "message-1",
            role: "assistant",
            parts: [
              {
                id: "tool-1",
                type: "tool",
                tool: {
                  id: "tool-1",
                  name: "render-inline-extension",
                  state: "completed",
                  result: JSON.stringify({
                    ok: true,
                    inlineExtension: {
                      mode: "transient",
                      id: "inline-1",
                      name: "Knobs",
                      content: "<div>Knobs</div>",
                    },
                  }),
                  chatUI: { renderer: "core.inline-extension" },
                },
              },
            ],
          }}
        />,
      );
    });

    expect(
      container.querySelector('[data-testid="conversation-inline-extension"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Knobs");
    expect(container.textContent).not.toContain("render inline extension");
  });

  it("opens markdown links in a new external window", () => {
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as Window | null);

    act(() => {
      root.render(
        <AgentConversationMessageView
          message={{
            id: "message-1",
            role: "assistant",
            parts: [
              {
                id: "text-1",
                type: "text",
                text: "[Builder](https://builder.io/docs)",
              },
            ],
          }}
        />,
      );
    });

    container
      .querySelector("a")
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

    expect(open).toHaveBeenCalledWith(
      "https://builder.io/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not preserve file links from markdown", () => {
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as Window | null);

    act(() => {
      root.render(
        <AgentConversationMessageView
          message={{
            id: "message-1",
            role: "assistant",
            parts: [
              {
                id: "text-1",
                type: "text",
                text: "[Local file](file:///etc/passwd)",
              },
            ],
          }}
        />,
      );
    });

    expect(container.querySelector("a")).toBeNull();

    expect(open).not.toHaveBeenCalled();
  });
});
