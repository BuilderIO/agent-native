// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSendToAgentChat = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChat: mockSendToAgentChat,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "agent.topSignal": "Top signal",
      "agent.draftFollowUp": "Draft a follow-up",
    })[key] ?? key,
}));
import { resolveToolRenderer } from "@agent-native/toolkit/app/chat";

import { ResponseInsightCard } from "./register-chat-renderers.js";

describe("Forms response insight card", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    mockSendToAgentChat.mockClear();
  });

  function renderCard() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ResponseInsightCard
          context={{
            toolName: "show-response-insight",
            args: {},
            resultJson: {
              title: "Onboarding needs clearer guidance",
              detail: "11 people asked for setup help; 7 mentioned mobile.",
              followUpPrompt: "Draft a question about mobile setup.",
            },
            isRunning: false,
          }}
        />,
      );
    });
  }

  it("is registered for the AgentKit chat widget path", () => {
    expect(
      resolveToolRenderer({
        toolName: "show-response-insight",
        args: {},
        resultJson: {},
        isRunning: false,
        chatUI: { renderer: "forms.response-insight" },
      }),
    ).toBe(ResponseInsightCard);
  });

  it("prefills a grounded follow-up without submitting it", () => {
    renderCard();

    expect(container?.textContent).toContain(
      "Onboarding needs clearer guidance",
    );
    expect(container?.textContent).toContain("Top signal");
    const button = container?.querySelector("button");
    expect(button?.textContent).toContain("Draft a follow-up");

    act(() => {
      button?.click();
    });

    expect(mockSendToAgentChat).toHaveBeenCalledWith({
      message: "Draft a question about mobile setup.",
      submit: false,
      chatTarget: "local",
    });
  });
});
