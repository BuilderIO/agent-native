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
    editor: string | null;
  }) {
    shown = useEventAtEditStart(props.current, props.editor);
    return null;
  }

  function show(current: CalendarEvent, editor: string | null) {
    act(() => {
      root?.render(<EditStartHarness current={current} editor={editor} />);
    });
  }

  it("keeps the event as it was when editing began, until editing ends", () => {
    const read = event();
    const refreshed = event({ title: "Retro", revision: '"2"' });

    show(read, "title");
    show(refreshed, "title");
    expect(shown).toBe(read);

    show(refreshed, null);
    expect(shown).toBe(refreshed);

    show(refreshed, "title");
    expect(shown).toBe(refreshed);
  });

  it("starts over when the person moves straight to another editor", () => {
    const read = event();
    const refreshed = event({ location: "Room B", revision: '"2"' });

    show(read, "attachments");
    show(refreshed, "attachments");
    expect(shown).toBe(read);

    show(refreshed, "location");
    expect(shown).toBe(refreshed);
    show(event({ location: "Room C", revision: '"3"' }), "location");
    expect(shown).toBe(refreshed);
  });

  it("holds the event again after its id or account changes mid-edit", () => {
    show(event({ id: "temp-1" }), "title");
    const saved = event({ revision: '"2"' });
    show(saved, "title");
    expect(shown).toBe(saved);
    show(event({ title: "Retro", revision: '"3"' }), "title");
    expect(shown).toBe(saved);

    const moved = event({ accountEmail: "other@example.com" });
    show(moved, "title");
    expect(shown).toBe(moved);
  });
});

describe("eventAsShown", () => {
  it("saves against the event the gesture started from unless it was replaced", () => {
    const read = event();
    expect(eventAsShown(read, event({ revision: '"2"' }))).toBe(read);
    const replaced = event({ id: "google-event-2" });
    expect(eventAsShown(read, replaced)).toBe(replaced);
    const moved = event({ accountEmail: "other@example.com" });
    expect(eventAsShown(read, moved)).toBe(moved);
  });
});
