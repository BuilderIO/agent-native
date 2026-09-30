// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/agent-chat", () => ({
  markAgentChatHomeHandoff: vi.fn(),
  sendToAgentChat: sendToAgentChatMock,
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: (props: Record<string, unknown>) => (
    <div>
      {props.homeIntroSlot as React.ReactNode}
      <div data-testid="chat-composer" />
      {props.afterComposerSlot as React.ReactNode}
    </div>
  ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const strings: Record<string, string> = {
      "create.heroTitle": "Create something visual",
      "create.heroDescription": "Describe the image or video you need.",
      "create.starters.image": "Image",
      "create.starters.video": "Video",
      "create.starters.refine": "Refine",
    };
    return strings[key] ?? key;
  },
}));

vi.mock("@agent-native/toolkit/agentkit", () => ({
  AgentSuggestionBar: ({
    suggestions,
    onSelect,
  }: {
    suggestions: Array<{ id: string; label: string; prompt?: string }>;
    onSelect: (suggestion: {
      id: string;
      label: string;
      prompt?: string;
    }) => void;
  }) => (
    <div data-testid="agent-suggestion-bar">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  ),
  agentSuggestionPrompt: (suggestion: { prompt?: string; label: string }) =>
    suggestion.prompt ?? suggestion.label,
}));

vi.mock("@/components/create/RecentDraftsSection", () => ({
  RecentDraftsSection: () => null,
}));

vi.mock("@/components/generation/GenerationResults", () => ({
  GenerationResults: () => null,
}));

vi.mock("@/hooks/use-image-model-menu", () => ({
  useImageModelMenu: () => null,
}));

vi.mock("@/lib/chat", () => ({
  ASSETS_CHAT_STORAGE_KEY: "assets-chat",
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ threadId: undefined }),
}));

import CreatePage from "./home";

describe("Assets Create chat home", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  it("shows title-only intro and prefills starter prompts below the composer", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root.render(<CreatePage />));

    expect(container.querySelector("h1")?.textContent).toBe(
      "Create something visual",
    );
    expect(container.textContent).not.toContain(
      "Describe the image or video you need.",
    );
    expect(container.querySelector(".assets-create-chat-intro p")).toBeNull();

    const composer = container.querySelector("[data-testid='chat-composer']");
    const suggestionBar = container.querySelector(
      "[data-testid='agent-suggestion-bar']",
    );
    expect(composer).not.toBeNull();
    expect(suggestionBar).not.toBeNull();
    expect(
      composer!.compareDocumentPosition(suggestionBar!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const imageSuggestion = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Image");
    expect(imageSuggestion).toBeDefined();
    act(() => imageSuggestion?.click());

    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: "Create an image of ",
      submit: false,
      openSidebar: false,
    });
  });
});
