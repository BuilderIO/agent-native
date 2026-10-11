// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { index?: number }) =>
    ({
      "animations.title": "Transitions",
      "animations.close": "Close transitions panel",
      "animations.selectObject": "Select an object to animate",
      "animations.addTransition": "Add transition",
      "animations.emptyDescription":
        "Select an object on the slide to add a transition.",
      "animations.appear": "Appear",
      "animations.onClick": "On click",
      "animations.byParagraph": "By paragraph",
      "animations.play": "Play",
      "animations.expand": "Expand transition",
      "animations.collapse": "Collapse transition",
      "animations.reorder": "Reorder transition",
      "animations.remove": "Remove transition",
      "animations.elementFallback": "Element " + (values?.index ?? ""),
    })[key] ?? key,
}));

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

const selectedTarget = {
  elementIndex: 1,
  elementPath: [1],
  preview: "Slide Title",
};

describe("AnimationsPanel", () => {
  afterEach(cleanup);

  it("asks the canvas selection for an object before adding a transition", () => {
    render(
      <AnimationsPanel
        slide={slide}
        onUpdateSlide={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: /select an object to animate/i,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("SECTION")).toBeNull();
  });

  it("adds the selected object with an ordered path and Google-like defaults", () => {
    const onUpdateSlide = vi.fn();
    const { rerender } = render(
      <AnimationsPanel
        slide={slide}
        selectedTarget={selectedTarget}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add transition/i }));

    expect(onUpdateSlide).toHaveBeenCalledWith({
      animations: [
        expect.objectContaining({
          elementIndex: 1,
          elementPath: [1],
          type: "appear",
        }),
      ],
    });

    rerender(
      <AnimationsPanel
        slide={{
          ...slide,
          animations: onUpdateSlide.mock.calls[0]?.[0]?.animations,
        }}
        selectedTarget={selectedTarget}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Appear/ })).toBeTruthy();
    // The Trigger dropdown is hidden until a trigger other than On click exists.
    expect(
      screen.queryByRole("combobox", { name: "animations.trigger" }),
    ).toBeNull();
  });

  it("says a refused add was not applied, not that the stored reveals are blocked", () => {
    const onUpdateSlide = vi.fn();
    const paragraphSlide = {
      ...slide,
      content: `<div class="fmd-slide"><div class="list"><p>First</p><p>Second</p></div></div>`,
      animations: [
        {
          id: "list",
          elementIndex: 0,
          elementPath: [0, 0],
          byParagraph: true,
          type: "fade" as const,
        },
      ],
    };
    render(
      <AnimationsPanel
        slide={paragraphSlide}
        selectedTarget={{
          elementIndex: 0,
          elementPath: [0],
          preview: "First",
        }}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add transition/i }));

    expect(onUpdateSlide).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("animations.issueDuplicate");
    expect(alert.textContent).toContain("animations.changeNotApplied");
    expect(alert.textContent).not.toContain("animations.blocked");
  });

  it("persists the paragraph setting for an expanded transition", () => {
    const onUpdateSlide = vi.fn();
    render(
      <AnimationsPanel
        slide={{
          ...slide,
          animations: [
            {
              id: "animation-1",
              elementIndex: 1,
              elementPath: [1],
              type: "appear",
            },
          ],
        }}
        selectedTarget={selectedTarget}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("By paragraph"));

    expect(onUpdateSlide).toHaveBeenCalledWith({
      animations: [
        expect.objectContaining({ id: "animation-1", byParagraph: true }),
      ],
    });
  });

  it("saves removing one stored unresolved reveal while another stays unresolved", () => {
    const onUpdateSlide = vi.fn();
    render(
      <AnimationsPanel
        slide={{
          ...slide,
          animations: [
            { id: "gone-a", elementIndex: 0, elementPath: [7], type: "fade" },
            { id: "gone-b", elementIndex: 0, elementPath: [8], type: "fade" },
            { id: "ok", elementIndex: 1, elementPath: [1], type: "fade" },
          ],
        }}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove transition" })[0]!,
    );

    expect(onUpdateSlide).toHaveBeenCalledWith({
      animations: [
        expect.objectContaining({ id: "gone-b" }),
        expect.objectContaining({ id: "ok" }),
      ],
    });
    expect(screen.getByRole("alert").textContent).not.toContain(
      "animations.changeNotApplied",
    );
  });

  it("refuses a new unresolved reveal while stored unresolved reveals remain", () => {
    const onUpdateSlide = vi.fn();
    render(
      <AnimationsPanel
        slide={{
          ...slide,
          animations: [
            { id: "gone-a", elementIndex: 0, elementPath: [7], type: "fade" },
            { id: "gone-b", elementIndex: 0, elementPath: [8], type: "fade" },
          ],
        }}
        selectedTarget={{
          elementIndex: 0,
          elementPath: [9],
          preview: "Missing",
        }}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add transition/i }));

    expect(onUpdateSlide).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("animations.issueStalePath");
    expect(alert.textContent).toContain("animations.changeNotApplied");
  });
});
