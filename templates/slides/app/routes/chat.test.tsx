// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { chatSurfaceMock } = vi.hoisted(() => ({ chatSurfaceMock: vi.fn() }));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentChatSurface: (props: Record<string, unknown>) => {
    chatSurfaceMock(props);
    return null;
  },
  markAgentChatHomeHandoff: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    key === "agent.slideNumber" ? `Slide ${values?.number}` : key,
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "slides-test" }));

import { publishSlidesSelection } from "@/lib/slide-agent-context";

import ChatRoute from "./chat";

afterEach(() => {
  cleanup();
  publishSlidesSelection(null);
  chatSurfaceMock.mockClear();
});

describe("Slides chat route", () => {
  it("updates the scope label and agent context after slide navigation", () => {
    render(
      <MemoryRouter initialEntries={["/chat?deckId=deck-1"]}>
        <Routes>
          <Route path="/chat" element={<ChatRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(chatSurfaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          label: "agent.thisSlide",
          context: expect.stringContaining(
            "Current slide id is not available.",
          ),
        }),
      }),
    );

    act(() => {
      publishSlidesSelection({
        deckId: "deck-1",
        slideId: "slide-2",
        slideIndex: 1,
        slideNumber: 2,
        items: [],
      });
    });

    expect(chatSurfaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          label: "Slide 2",
          context: expect.stringContaining("Current slide id: slide-2."),
        }),
      }),
    );
  });
});
