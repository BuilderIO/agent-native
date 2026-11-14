// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./AgentPanel.js";

const chatProps = vi.hoisted(() => ({ current: null as any }));

vi.mock("./MultiTabAssistantChat.js", () => ({
  MultiTabAssistantChat: (props: unknown) => {
    chatProps.current = props;
    return null;
  },
}));

vi.mock("../sharing/index.js", () => ({
  ShareButton: () => null,
}));

describe("AgentPanel execution mode", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    chatProps.current = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("ignores a Plan mode stored by the retired picker", async () => {
    localStorage.setItem("agent-native-exec-mode", "plan");
    localStorage.setItem("agent-native-exec-mode:legacy-plan", "plan");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AgentPanel storageKey="legacy-plan" />
        </MemoryRouter>,
      );
    });

    expect(chatProps.current).not.toBeNull();
    expect(chatProps.current).not.toHaveProperty("execMode");
    expect(chatProps.current).not.toHaveProperty("onExecModeChange");
    expect(localStorage.getItem("agent-native-exec-mode:legacy-plan")).toBe(
      "plan",
    );
  });
});
