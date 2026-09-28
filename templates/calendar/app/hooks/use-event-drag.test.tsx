// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEventDrag } from "./use-event-drag";

const event: CalendarEvent = {
  id: "event-1",
  title: "Planning",
  description: "",
  start: "2026-06-01T10:00:00.000Z",
  end: "2026-06-01T11:00:00.000Z",
  location: "",
  allDay: false,
  source: "google",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
};

describe("useEventDrag", () => {
  let container: HTMLDivElement;
  let root: Root;
  let drag: ReturnType<typeof useEventDrag> | undefined;
  let pendingFrame: FrameRequestCallback | undefined;

  function Harness({
    onEventTimeChange,
  }: {
    onEventTimeChange: (
      event: CalendarEvent,
      newStart: Date,
      newEnd: Date,
    ) => void | PromiseLike<void>;
  }) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    drag = useEventDrag({
      hourHeight: 60,
      startHour: 0,
      scrollContainerRef,
      onEventTimeChange,
      timezone: "UTC",
    });
    return (
      <div ref={scrollContainerRef}>
        <button type="button">Event</button>
      </div>
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    drag = undefined;
    pendingFrame = undefined;
  });

  it("keeps the final drag preview until the asynchronous confirmation/write settles", async () => {
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const onEventTimeChange = vi.fn(() => write);

    act(() => root.render(<Harness onEventTimeChange={onEventTimeChange} />));
    const target = container.querySelector("button")!;
    Object.defineProperty(target, "setPointerCapture", { value: () => {} });
    const rect = {
      top: 0,
      left: 0,
      right: 700,
      bottom: 1200,
      width: 700,
      height: 1200,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    Object.defineProperty(
      container.firstElementChild,
      "getBoundingClientRect",
      {
        value: () => rect,
      },
    );

    const pointerDown = {
      button: 0,
      clientX: 10,
      clientY: 610,
      pointerId: 1,
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLButtonElement>;
    act(() => drag!.startDrag(pointerDown, event, "move", 0));

    const pointerMove = new Event("pointermove");
    Object.defineProperties(pointerMove, {
      clientX: { value: 10 },
      clientY: { value: 670 },
    });
    act(() => {
      window.dispatchEvent(pointerMove);
      pendingFrame?.(0);
    });

    act(() => window.dispatchEvent(new Event("pointerup")));
    expect(onEventTimeChange).toHaveBeenCalledWith(
      event,
      new Date("2026-06-01T11:00:00.000Z"),
      new Date("2026-06-01T12:00:00.000Z"),
    );
    expect(drag?.getDragOverrides(event)).toMatchObject({ top: 660 });
    expect(drag?.isDragging).toBe(true);

    await act(async () => {
      finishWrite();
      await write;
      await Promise.resolve();
    });
    expect(drag?.getDragOverrides(event)).toBeNull();
  });

  it("keeps resize identity when calendar event ids collide", () => {
    const first = {
      ...event,
      accountEmail: "steve@builder.io",
      calendarSourceKey: "calendar-source-a",
      calendarId: "calendar-a",
    };
    const selected = {
      ...event,
      start: "2026-06-01T13:00:00.000Z",
      end: "2026-06-01T14:00:00.000Z",
      accountEmail: "steve@builder.io",
      calendarSourceKey: "calendar-source-b",
      calendarId: "calendar-b",
    };
    const onEventTimeChange = vi.fn();

    act(() => root.render(<Harness onEventTimeChange={onEventTimeChange} />));
    const target = container.querySelector("button")!;
    Object.defineProperty(target, "setPointerCapture", { value: () => {} });
    const rect = {
      top: 0,
      left: 0,
      right: 700,
      bottom: 1200,
      width: 700,
      height: 1200,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    Object.defineProperty(
      container.firstElementChild,
      "getBoundingClientRect",
      { value: () => rect },
    );

    const pointerDown = {
      button: 0,
      clientX: 10,
      clientY: 840,
      pointerId: 1,
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent<HTMLButtonElement>;
    act(() => drag!.startDrag(pointerDown, selected, "resize", 0));

    expect(drag?.isDraggingEvent(first)).toBe(false);
    expect(drag?.isDraggingEvent(selected)).toBe(true);
    expect(drag?.getDragOverrides(first)).toBeNull();
    expect(drag?.getDragOverrides(selected)).not.toBeNull();

    const pointerMove = new Event("pointermove");
    Object.defineProperties(pointerMove, {
      clientX: { value: 10 },
      clientY: { value: 900 },
    });
    act(() => {
      window.dispatchEvent(pointerMove);
      pendingFrame?.(0);
    });
    act(() => window.dispatchEvent(new Event("pointerup")));

    expect(onEventTimeChange).toHaveBeenCalledWith(
      selected,
      new Date("2026-06-01T13:00:00.000Z"),
      new Date("2026-06-01T15:00:00.000Z"),
    );
  });
});
