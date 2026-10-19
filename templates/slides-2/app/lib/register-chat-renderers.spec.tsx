// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useActionQueryMock } = vi.hoisted(() => ({
  useActionQueryMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: useActionQueryMock,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "history.slideCount") return `${values?.count} slides`;
    if (key === "agent.slideNumber") return `Slide ${values?.number}`;
    return (
      {
        "deckResult.saved": "Saved",
        "deckEditor.accessApprovalOpenDeck": "Open deck",
        "deckEditor.continueInChat": "Continue in chat",
      }[key] ?? key
    );
  },
}));
import { resolveToolRenderer } from "@agent-native/toolkit/app/chat";
import { type ToolRendererContext } from "@agent-native/toolkit/app/chat/chat";
import {
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  SLIDES_DECK_RESULT_RENDERER,
} from "@shared/action-ui";

import "./register-chat-renderers.js";

describe("Slides deck result card", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useActionQueryMock.mockReset();
    useActionQueryMock.mockReturnValue({ data: undefined, isPending: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders projected deck details and an encoded internal open link", async () => {
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {},
      resultJson: {
        id: "deck/1",
        title: "Launch brief",
        slideCount: 12,
        slides: Array.from({ length: 4 }, (_, index) => ({
          id: `slide-${index + 1}`,
          layout: "content",
          content: `<div class="fmd-slide"><h1>Slide ${index + 1}</h1><script>untrusted</script></div>`,
        })),
      },
      isRunning: false,
      chatUI: { renderer: SLIDES_DECK_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Slides deck result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-action-card]")).not.toBeNull();
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("12 slides");
    expect(container.querySelector("script")).toBeNull();
    const previewStrip = container.querySelector(
      "[data-slides-deck-preview-strip]",
    );
    expect(previewStrip?.hasAttribute("inert")).toBe(true);
    expect(previewStrip?.querySelectorAll(":scope > div")).toHaveLength(3);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/deck/deck%2F1");
    expect(link?.className).toContain("active:scale-[0.98]");
    expect(link?.className).toContain("bg-background");
  });

  it("ignores results without a deck id, title, or slide count", async () => {
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {},
      resultJson: { id: "deck-1", title: "Launch brief" },
      isRunning: false,
      chatUI: { renderer: SLIDES_DECK_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Slides deck result renderer is missing");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("[data-action-card]")).toBeNull();
  });

  it("renders an incremental slide preview and routes to its editor and chat scope", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck/1",
        title: "Launch brief",
        slideCount: 12,
        slides: [
          {
            id: "slide-2",
            layout: "content",
            content:
              '<div class="fmd-slide"><h1>Saved slide</h1><script>untrusted</script></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "add-slide",
      args: {},
      resultJson: {
        deckId: "deck/1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
        slideCount: 12,
      },
      isRunning: false,
      chatUI: { renderer: SLIDES_ADDED_SLIDE_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Added slide result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck/1", slideId: "slide-2", compact: "false" },
      { enabled: true },
    );
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Slide 2");
    expect(container.textContent).toContain("Continue in chat");
    expect(container.querySelector("script")).toBeNull();
    expect(
      container.querySelector("[data-slides-added-slide-preview]"),
    ).not.toBeNull();
    expect(
      container
        .querySelector("[data-slides-added-slide-preview]")
        ?.hasAttribute("inert"),
    ).toBe(true);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/deck/deck%2F1?slide=2",
      "/chat?deckId=deck%2F1&slideId=slide-2&slideNumber=2",
    ]);
  });
});
