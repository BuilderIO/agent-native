// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "history.slideCount") return `${values?.count} slides`;
    return (
      {
        "deckResult.saved": "Saved",
        "deckEditor.accessApprovalOpenDeck": "Open deck",
      }[key] ?? key
    );
  },
}));

import {
  resolveToolRenderer,
  type ToolRendererContext,
} from "@agent-native/core/client/chat";
import { SLIDES_DECK_RESULT_RENDERER } from "@shared/action-ui";

import "./register-chat-renderers.js";

describe("Slides deck result card", () => {
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
    expect(link?.className).toContain("transition-none");
    expect(link?.className).toContain("active:scale-100");
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
});
