// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimationsPanel } from "@/components/editor/AnimationsPanel";
import type { Slide } from "@/context/DeckContext";

const slide: Slide = {
  id: "slide-1",
  layout: "content",
  notes: "",
  content: `<div class="fmd-slide" style="padding: 80px 110px; justify-content: center;">
  <div style="font-size: 16px;">SECTION</div>
  <div style="font-size: 40px;">Slide Title</div>
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>First point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>Second point</span></div>
  </div>
</div>`,
};

describe("AnimationsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists all animatable slide elements instead of only one legacy container", () => {
    render(
      <AnimationsPanel
        slide={slide}
        onUpdateSlide={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("SECTION")).toBeTruthy();
    expect(screen.getByText("Slide Title")).toBeTruthy();
    expect(screen.getByText("•First point")).toBeTruthy();
    expect(screen.getByText("•Second point")).toBeTruthy();
  });

  it("stores element paths for new animations", () => {
    const onUpdateSlide = vi.fn();
    render(
      <AnimationsPanel
        slide={slide}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Auto-fill"));

    expect(onUpdateSlide).toHaveBeenCalledWith({
      animations: [
        expect.objectContaining({ elementIndex: 0, elementPath: [0] }),
        expect.objectContaining({ elementIndex: 1, elementPath: [1] }),
        expect.objectContaining({ elementIndex: 2, elementPath: [2, 0] }),
        expect.objectContaining({ elementIndex: 3, elementPath: [2, 1] }),
      ],
    });
  });
});
