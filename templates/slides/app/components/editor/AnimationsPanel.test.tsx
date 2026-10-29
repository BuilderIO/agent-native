// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { index?: number }) =>
    ({
      "animations.title": "Animations",
      "animations.close": "Close animations panel",
      "animations.selectObject": "Select an object to animate",
      "animations.addAnimation": "Add animation",
      "animations.alreadyAnimated": "Already animated",
      "animations.emptyDescription":
        "Select an object on the slide to add an animation.",
      "animations.appear": "Appear",
      "animations.onClick": "On click",
      "animations.byParagraph": "By paragraph",
      "animations.play": "Play",
      "animations.expand": "Expand animation",
      "animations.collapse": "Collapse animation",
      "animations.reorder": "Reorder animation",
      "animations.remove": "Remove animation",
      "animations.elementFallback": "Element " + (values?.index ?? ""),
    })[key] ?? key,
}));

import { AnimationsPanel } from "@/components/editor/AnimationsPanel";
import type { Slide, SlideAnimation } from "@/context/DeckContext";

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

  it("asks the canvas selection for an object before adding an animation", () => {
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
        selectedTargets={[selectedTarget]}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add animation/i }));

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
        selectedTargets={[selectedTarget]}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Appear/ })).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "animations.trigger" }),
    ).toBeTruthy();
  });

  it("adds every selected object, the first on click and the rest with previous", () => {
    const onUpdateSlide = vi.fn();
    render(
      <AnimationsPanel
        slide={{
          ...slide,
          content: `<div class="fmd-slide"><h1>A</h1><p>B</p><p>C</p></div>`,
        }}
        selectedTargets={[
          { elementIndex: 0, elementPath: [0], preview: "A" },
          { elementIndex: 1, elementPath: [1], preview: "B" },
          { elementIndex: 2, elementPath: [2], preview: "C" },
        ]}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add animation/i }));

    const [{ animations }] = onUpdateSlide.mock.calls[0]!;
    expect(
      animations.map((a: SlideAnimation) => [a.elementPath, a.trigger]),
    ).toEqual([
      [[0], undefined],
      [[1], "with-previous"],
      [[2], "with-previous"],
    ]);
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
        selectedTargets={[
          {
            elementIndex: 0,
            elementPath: [0],
            preview: "First",
          },
        ]}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add animation/i }));

    expect(onUpdateSlide).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("animations.issueDuplicate");
    expect(alert.textContent).toContain("animations.changeNotApplied");
    expect(alert.textContent).not.toContain("animations.blocked");
  });

  it("says why the add button is off when the selection is already animated", () => {
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
        selectedTargets={[selectedTarget]}
        onUpdateSlide={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Already animated" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /add animation/i })).toBeNull();
  });

  it("persists the paragraph setting for an expanded animation", () => {
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
        selectedTargets={[selectedTarget]}
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

    const removeFirst = screen
      .getAllByRole("button", { name: "Remove animation" })
      .at(0);
    if (!removeFirst) throw new Error("Expected a Remove animation button");
    fireEvent.click(removeFirst);

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
        selectedTargets={[
          {
            elementIndex: 0,
            elementPath: [9],
            preview: "Missing",
          },
        ]}
        onUpdateSlide={onUpdateSlide}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add animation/i }));

    expect(onUpdateSlide).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("animations.issueStalePath");
    expect(alert.textContent).toContain("animations.changeNotApplied");
  });
});
