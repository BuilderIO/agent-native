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

import { DEFAULT_EDITS, type EditsJson } from "@/lib/timestamp-mapping";

import { TimelineTrack, type TrackSelection } from "./timeline-track";

const DURATION = 10_000;
const WIDTH = 1_000;

function pointer(target: Element, type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("TimelineTrack viewport interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onCommit: Mock<(edits: EditsJson) => void>;
  let onPreview: Mock<(edits: EditsJson | null) => void>;
  let onSelectionChange: Mock<(selection: TrackSelection | null) => void>;

  const firstPiece = () => {
    const piece = container.querySelector('[role="button"]');
    if (!piece) throw new Error("no timeline piece rendered");
    return piece;
  };
  const track = () => {
    const element = container.firstElementChild;
    if (!element) throw new Error("no timeline track rendered");
    return element;
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onCommit = vi.fn<(edits: EditsJson) => void>();
    onPreview = vi.fn<(edits: EditsJson | null) => void>();
    onSelectionChange = vi.fn<(selection: TrackSelection | null) => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("projects the range summary into the scrolled viewport while dragging", () => {
    function ControlledTrack() {
      const [selection, setSelection] = React.useState<TrackSelection | null>({
        kind: "range",
        startMs: 2_000,
        endMs: 6_000,
      });
      return (
        <TimelineTrack
          width={WIDTH}
          viewportWidth={200}
          scrollLeft={300}
          height={100}
          durationMs={DURATION}
          edits={DEFAULT_EDITS}
          selection={selection}
          onSelectionChange={setSelection}
          onPreview={onPreview}
          onCommit={onCommit}
        />
      );
    }

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: -300,
      top: 0,
      right: 700,
      bottom: 100,
      width: WIDTH,
      height: 100,
      x: -300,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    act(() => root.render(<ControlledTrack />));

    const expectSummary = (text: string, x: number) => {
      const spans = Array.from(container.querySelectorAll("span")).filter(
        (span) => span.textContent.replace(/\.\d{3}$/, "") === text,
      );
      expect(spans).toHaveLength(1);
      const span = spans.pop();
      if (!span) throw new Error("range summary not rendered");
      expect(span.parentElement?.style.left).toBe("300px");
      expect(span.parentElement?.style.width).toBe("200px");
      expect(
        span.parentElement?.classList.contains("pointer-events-none"),
      ).toBe(true);
      expect(span.style.left).toBe(`${x}px`);
      expect(span.style.maxWidth).toBe("200px");
      expect(span.style.transform).toBe(
        `translateX(clamp(max(-100%, -${x}px), -50%, min(0px, calc(${200 - x}px - 100%))))`,
      );
    };

    expectSummary("00:02.000 – 00:06.000 · 00:04", 100);
    act(() => {
      pointer(firstPiece(), "pointerdown", 100);
      pointer(track(), "pointermove", 150);
    });
    expectSummary("00:02.500 – 00:06.500 · 00:04", 100);
    act(() => pointer(track(), "pointermove", 680));
    expectSummary("00:06.000 – 00:10.000 · 00:04", 200);
    act(() => pointer(track(), "pointerup", 680));
    expectSummary("00:06.000 – 00:10.000 · 00:04", 200);

    const renderRange = (startMs: number, endMs: number) => {
      act(() =>
        root.render(
          <TimelineTrack
            width={WIDTH}
            viewportWidth={200}
            scrollLeft={300}
            height={100}
            durationMs={DURATION}
            edits={DEFAULT_EDITS}
            selection={{ kind: "range", startMs, endMs }}
            onSelectionChange={onSelectionChange}
            onPreview={onPreview}
            onCommit={onCommit}
          />,
        ),
      );
    };
    renderRange(0, 1_500);
    expectSummary("00:00.000 – 00:01.500 · 00:01", 0);
    renderRange(4_900, 4_950);
    expectSummary("00:04.900 – 00:04.950 · 00:00", 192.5);
    renderRange(4_900, 6_000);
    expectSummary("00:04.900 – 00:06.000 · 00:01", 195);
  });
});
