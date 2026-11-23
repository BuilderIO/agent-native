// @vitest-environment happy-dom
import type { CalendarEvent } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eventAsShown, useEventAtEditStart } from "./use-event-at-edit-start";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const base: CalendarEvent = {
    id: "google-event-1",
    title: "Planning",
    description: "",
    start: "2026-11-23T15:00:00-05:00",
    end: "2026-11-23T16:00:00-05:00",
    location: "Room A",
    allDay: false,
    source: "google",
    accountEmail: "agent@example.com",
    revision: '"1"',
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
  return Object.assign(base, overrides);
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("useEventAtEditStart", () => {
  let shown: CalendarEvent | null = null;

  function EditStartHarness(props: {
    current: CalendarEvent;
    editing: boolean;
  }) {
    shown = useEventAtEditStart(props.current, props.editing);
    return null;
  }

  function show(current: CalendarEvent, editing: boolean) {
    act(() => {
      root?.render(<EditStartHarness current={current} editing={editing} />);
    });
  }

  it("keeps the event as it was when editing began, until editing ends", () => {
    const read = event();
    const refreshed = event({ title: "Retro", revision: '"2"' });

    show(read, true);
    show(refreshed, true);
    expect(shown).toBe(read);

    show(refreshed, false);
    expect(shown).toBe(refreshed);

    show(refreshed, true);
    expect(shown).toBe(refreshed);
  });
});

describe("eventAsShown", () => {
  it("saves against the event the gesture started from unless it was replaced", () => {
    const read = event();
    expect(eventAsShown(read, event({ revision: '"2"' }))).toBe(read);
    const replaced = event({ id: "google-event-2" });
    expect(eventAsShown(read, replaced)).toBe(replaced);
  });
});
