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

function renderEvent() {
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
});
