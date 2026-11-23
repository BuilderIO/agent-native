import type { CalendarEvent } from "@shared/api";
import { useEffect, useState } from "react";

export function eventAsShown(
  shown: CalendarEvent,
  current: CalendarEvent,
): CalendarEvent {
  return shown.id === current.id && shown.accountEmail === current.accountEmail
    ? shown
    : current;
}

export function useEventAtEditStart<E extends CalendarEvent | null>(
  event: E,
  editing: boolean,
): E {
  const [atStart, setAtStart] = useState<{ event: E } | null>(null);
  useEffect(() => {
    setAtStart((held) => (editing ? (held ?? { event }) : null));
  }, [editing, event]);
  const held = atStart?.event;
  return editing && held && event && held.id === event.id ? held : event;
}
