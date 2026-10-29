// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tabler/icons-react", () => ({
  IconArrowBackUp: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-icon-restore {...props} />
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import {
  DEFAULT_EDITS,
  addCut,
  addSplitAt,
  getCuts,
  type EditsJson,
} from "@/lib/timestamp-mapping";

import { TimelineTrack, type TrackSelection } from "./timeline-track";

const DURATION = 10_000;
const WIDTH = 1_000;

function pointer(target: Element, type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("TimelineTrack pointer gestures", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onCommit: Mock<(edits: EditsJson) => void>;
  let onPreview: Mock<(edits: EditsJson | null) => void>;
  let onSelectionChange: Mock<(selection: TrackSelection | null) => void>;
  let onSeek: Mock<(originalMs: number) => void>;

  const render = (
    edits: EditsJson,
    selection: TrackSelection | null = null,
  ) => {
    act(() => {
      root.render(
        <TimelineTrack
          width={WIDTH}
          height={100}
          durationMs={DURATION}
          edits={edits}
          selection={selection}
          onSelectionChange={onSelectionChange}
          onPreview={onPreview}
          onCommit={onCommit}
          onSeek={onSeek}
        />,
      );
    });
  };

  const pieces = () =>
    Array.from(container.querySelectorAll('[role="button"]'));
  const firstPiece = () => {
    const piece = pieces().shift();
    if (!piece) throw new Error("no timeline piece rendered");
    return piece;
  };
  const track = () => container.firstElementChild!;
  const handles = () =>
    Array.from(container.querySelectorAll("[data-side]")) as HTMLElement[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: WIDTH,
      bottom: 100,
      width: WIDTH,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    onCommit = vi.fn<(edits: EditsJson) => void>();
    onPreview = vi.fn<(edits: EditsJson | null) => void>();
    onSelectionChange = vi.fn<(selection: TrackSelection | null) => void>();
    onSeek = vi.fn<(originalMs: number) => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("selects the section that was clicked, and takes the playhead there", () => {
    render(DEFAULT_EDITS);

    act(() => {
      pointer(pieces()[0], "pointerdown", 500);
      pointer(track(), "pointerup", 500);
    });

    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "clip",
      anchorMs: 5_000,
    });
    expect(onSeek).toHaveBeenCalledWith(5_000);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("never cuts from a drag across the body of a section", () => {
    render(DEFAULT_EDITS);

    act(() => {
      pointer(pieces()[0], "pointerdown", 100);
      pointer(track(), "pointermove", 400);
      pointer(track(), "pointerup", 400);
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ trims: expect.anything() }),
    );
  });

  it("selects an exact range when dragging across a section", () => {
    render(DEFAULT_EDITS);

    act(() => {
      pointer(pieces()[0], "pointerdown", 200);
      pointer(track(), "pointermove", 650);
      pointer(track(), "pointerup", 650);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      kind: "range",
      startMs: 2_000,
      endMs: 6_500,
    });
    expect(onSeek).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  describe("with a range already selected", () => {
    const RANGE: TrackSelection = {
      kind: "range",
      startMs: 2_000,
      endMs: 6_000,
    };

    it("moves the range when the drag starts inside it", () => {
      render(DEFAULT_EDITS, RANGE);

      act(() => {
        pointer(firstPiece(), "pointerdown", 400);
        pointer(track(), "pointermove", 500);
        pointer(track(), "pointerup", 500);
      });

      expect(onSelectionChange).toHaveBeenLastCalledWith({
        kind: "range",
        startMs: 3_000,
        endMs: 7_000,
      });
    });

    it("keeps the range length when moved past the end of the track", () => {
      render(DEFAULT_EDITS, RANGE);

      act(() => {
        pointer(firstPiece(), "pointerdown", 400);
        pointer(track(), "pointermove", 990);
        pointer(track(), "pointerup", 990);
      });

      expect(onSelectionChange).toHaveBeenLastCalledWith({
        kind: "range",
        startMs: 6_000,
        endMs: 10_000,
      });
    });

    it("resizes from the edge, keeping the opposite edge fixed", () => {
      render(DEFAULT_EDITS, RANGE);

      act(() => {
        pointer(firstPiece(), "pointerdown", 602);
        pointer(track(), "pointermove", 800);
        pointer(track(), "pointerup", 800);
      });

      expect(onSelectionChange).toHaveBeenLastCalledWith({
        kind: "range",
        startMs: 2_000,
        endMs: 8_000,
      });
    });

    it("starts a new selection when the drag starts outside the range", () => {
      render(DEFAULT_EDITS, RANGE);

      act(() => {
        pointer(firstPiece(), "pointerdown", 800);
        pointer(track(), "pointermove", 900);
        pointer(track(), "pointerup", 900);
      });

      expect(onSelectionChange).toHaveBeenLastCalledWith({
        kind: "range",
        startMs: 8_000,
        endMs: 9_000,
      });
    });
  });

  it("keeps edge drags separate from range drags", () => {
    render(addSplitAt(DEFAULT_EDITS, 4_000, "split-a"));

    act(() => {
      pointer(handles()[0], "pointerdown", 400);
      pointer(track(), "pointermove", 250);
      pointer(track(), "pointerup", 250);
    });

    expect(getCuts(onCommit.mock.calls[0][0])).toMatchObject([
      { startMs: 2_500, endMs: 4_000 },
    ]);
    expect(onSelectionChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "range" }),
    );
  });

  it("selects the section on a click that does not drag", () => {
    render(DEFAULT_EDITS);

    act(() => {
      pointer(pieces()[0], "pointerdown", 500);
      pointer(track(), "pointerup", 500);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      kind: "clip",
      anchorMs: 5_000,
    });
    expect(onSeek).toHaveBeenCalledWith(5_000);
  });

  it("removes what the line is dragged past, and selects the section on the left", () => {
    render(addSplitAt(DEFAULT_EDITS, 4_000, "split-a"));
    const [line] = handles();
    expect(line.dataset.side).toBe("clip-end");

    act(() => {
      pointer(line, "pointerdown", 400);
      pointer(track(), "pointermove", 250);
      pointer(track(), "pointerup", 250);
    });

    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "clip",
      anchorMs: 0,
    });
    expect(getCuts(onCommit.mock.calls[0][0])).toMatchObject([
      { startMs: 2_500, endMs: 4_000 },
    ]);
  });

  it("goes the other way once the section on the right is the selected one", () => {
    render(addSplitAt(DEFAULT_EDITS, 4_000, "split-a"), {
      kind: "clip",
      anchorMs: 7_000,
    });
    const [line] = handles();
    expect(line.dataset.side).toBe("clip-start");

    act(() => {
      pointer(line, "pointerdown", 400);
      pointer(track(), "pointermove", 550);
      pointer(track(), "pointerup", 550);
    });

    expect(getCuts(onCommit.mock.calls[0][0])).toMatchObject([
      { startMs: 4_000, endMs: 5_500 },
    ]);
  });

  it("moves the gap that is already there instead of leaving a second one", () => {
    render(addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a"));

    act(() => {
      pointer(handles()[0], "pointerdown", 300);
      pointer(track(), "pointermove", 150);
      pointer(track(), "pointerup", 150);
    });

    expect(getCuts(onCommit.mock.calls[0][0])).toEqual([
      { id: "cut-a", startMs: 1_500, endMs: 6_000, excluded: true },
    ]);
  });

  it("previews as the pointer moves, and clears the preview on release", () => {
    render(addSplitAt(DEFAULT_EDITS, 4_000, "split-a"));

    act(() => {
      pointer(handles()[0], "pointerdown", 400);
      pointer(track(), "pointermove", 350);
      pointer(track(), "pointermove", 200);
    });

    const previewed = onPreview.mock.calls.map(([edits]) =>
      edits ? getCuts(edits) : null,
    );
    expect(previewed[0]).toMatchObject([{ startMs: 3_500, endMs: 4_000 }]);
    expect(previewed[1]).toMatchObject([{ startMs: 2_000, endMs: 4_000 }]);

    act(() => pointer(track(), "pointerup", 200));
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("does not turn a press that barely moved into an edit", () => {
    render(addSplitAt(DEFAULT_EDITS, 4_000, "split-a"));

    act(() => {
      pointer(handles()[0], "pointerdown", 400);
      pointer(track(), "pointermove", 399);
      pointer(track(), "pointerup", 399);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("selects a removed stretch without dragging it anywhere", () => {
    render(addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a"));
    const gap = pieces().find(
      (el) => el.getAttribute("aria-label") === "timelineTrack.removedSection",
    )!;

    act(() => {
      pointer(gap, "pointerdown", 450);
      pointer(track(), "pointerup", 450);
    });

    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "gap",
      cutId: "cut-a",
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("puts a removed section back from its restore button", () => {
    render(addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a"));
    const restore = container.querySelector(
      '[aria-label="timelineTrack.putBack"]',
    ) as HTMLElement;
    expect(restore).toBeTruthy();

    act(() => restore.click());

    expect(getCuts(onCommit.mock.calls[0][0])).toEqual([]);
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it("marks the selected section for the screen reader", () => {
    render(addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a"), {
      kind: "gap",
      cutId: "cut-a",
    });
    const gap = pieces().find(
      (el) => el.getAttribute("aria-label") === "timelineTrack.removedSection",
    );
    expect(gap?.getAttribute("aria-pressed")).toBe("true");
  });
});
