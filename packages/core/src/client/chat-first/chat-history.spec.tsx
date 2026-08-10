// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstChatHistory } from "./chat-history.js";

describe("ChatFirstChatHistory", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders no rail section when chat history is empty", () => {
    act(() => {
      root.render(
        <ChatFirstChatHistory
          items={[]}
          loading
          loadingLabel={<span>Loading chats</span>}
          emptyLabel="No chats yet."
        />,
      );
    });

    expect(
      container.querySelector("[data-chat-first-chat-history]"),
    ).toBeNull();
    expect(container.textContent).toBe("");
  });
});
