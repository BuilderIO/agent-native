import type { CalendarEvent } from "@shared/api";
import { useEffect, useState } from "react";

function sameEvent(a: CalendarEvent | null, b: CalendarEvent | null) {
  return !!a && !!b && a.id === b.id && a.accountEmail === b.accountEmail;
}

export function eventAsShown(
  shown: CalendarEvent,
  current: CalendarEvent,
): CalendarEvent {
  return sameEvent(shown, current) ? shown : current;
}

export function useEventAtEditStart<E extends CalendarEvent | null>(
  event: E,
  editor: string | null,
): E {
  const [atStart, setAtStart] = useState<{ editor: string; event: E } | null>(
    null,
  );
  useEffect(() => {
    setAtStart((held) => {
      if (editor === null) return null;
      return held && held.editor === editor && sameEvent(held.event, event)
        ? held
        : { editor, event };
    });
  }, [editor, event]);
  return editor !== null &&
    atStart?.editor === editor &&
    sameEvent(atStart.event, event)
    ? atStart.event
    : event;
}
