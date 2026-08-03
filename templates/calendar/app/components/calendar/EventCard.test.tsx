// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventCard } from "./EventCard";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string): string =>
      key,
}));

const event: CalendarEvent = {
  id: "event-1",
  title: "Planning session",
  description: "",
  location: "Room A",
  start: "2026-08-08T17:00:00.000Z",
  end: "2026-08-08T18:00:00.000Z",
  allDay: false,
  source: "local",
  createdAt: "2026-08-03T12:00:00.000Z",
  updatedAt: "2026-08-03T12:00:00.000Z",
  attendees: [],
};

describe("EventCard", () => {
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

  it("forwards trigger props and its ref to the underlying button", () => {
    const ref = createRef<HTMLButtonElement>();
    const onPointerEnter = vi.fn();

    act(() => {
      root.render(
        <EventCard
          ref={ref}
          event={event}
          className="preview-trigger"
          data-state="closed"
          onPointerEnter={onPointerEnter}
        />,
      );
    });

    const button = container.querySelector("button");
    expect(ref.current).toBe(button);
    expect(button?.classList.contains("preview-trigger")).toBe(true);
    expect(button?.getAttribute("data-state")).toBe("closed");

    act(() => {
      button?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });

    expect(onPointerEnter).toHaveBeenCalledOnce();
  });
});
