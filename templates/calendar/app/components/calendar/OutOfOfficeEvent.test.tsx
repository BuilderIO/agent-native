// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutOfOfficeEvent } from "./OutOfOfficeEvent";

vi.mock("./EventDetailPopover", () => ({
  EventDetailPopover: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

function outOfOfficeEvent(): CalendarEvent {
  return {
    id: "ooo-1",
    title: "Out of office",
    description: "",
    location: "",
    start: new Date(2026, 7, 8, 8, 0).toISOString(),
    end: new Date(2026, 7, 8, 10, 0).toISOString(),
    allDay: false,
    eventType: "outOfOffice",
    source: "google",
    createdAt: new Date(2026, 7, 1).toISOString(),
    updatedAt: new Date(2026, 7, 1).toISOString(),
  };
}

function renderEvent(
  props: Partial<Parameters<typeof OutOfOfficeEvent>[0]> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <OutOfOfficeEvent
        event={outOfOfficeEvent()}
        day={new Date(2026, 7, 8)}
        hourHeight={60}
        color="hsl(var(--primary))"
        label="Out of office"
        onDelete={vi.fn()}
        isDraft={false}
        defaultOpen={false}
        {...props}
      />,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("OutOfOfficeEvent", () => {
  it("uses the whole timed segment as the event trigger", () => {
    const { container, root } = renderEvent();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-out-of-office-trigger="ooo-1"]',
    );

    expect(trigger).not.toBeNull();
    expect(trigger?.style.top).toBe("480px");
    expect(trigger?.style.height).toBe("120px");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Out of office: Out of office",
    );

    act(() => root.unmount());
  });

  it("nests the drag resize handles inside the click trigger button", () => {
    // Regression test: when the resize handles are siblings of the trigger
    // button instead of children, a click landing on a handle (which sits
    // right on top of the visible marker icon, z-40) bubbles past the day
    // column's `closest("button")` create-event guard and opens a blank
    // draft event at an unrelated hour instead of this event's popover.
    const { container, root } = renderEvent({ canDrag: true });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-out-of-office-trigger="ooo-1"]',
    );
    const topHandle = container.querySelector<HTMLElement>(
      '[data-out-of-office-resize="top"]',
    );
    const bottomHandle = container.querySelector<HTMLElement>(
      '[data-out-of-office-resize="bottom"]',
    );

    expect(trigger).not.toBeNull();
    expect(topHandle).not.toBeNull();
    expect(bottomHandle).not.toBeNull();
    expect(topHandle?.closest("button")).toBe(trigger);
    expect(bottomHandle?.closest("button")).toBe(trigger);

    act(() => root.unmount());
  });
});
