import { useState, useCallback } from "react";

const STORAGE_KEY = "hidden-calendars";

interface HiddenCalendars {
  people: string[]; // overlay person emails
  external: string[]; // external calendar IDs
  accounts: string[]; // own Google account emails
}

function load(): HiddenCalendars {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { people: [], external: [], accounts: [] };
    return JSON.parse(raw);
  } catch {
    return { people: [], external: [], accounts: [] };
  }
}

function save(hidden: HiddenCalendars) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {}
}

export function useHiddenCalendars() {
  const [hidden, setHidden] = useState<HiddenCalendars>(load);

  const toggle = useCallback((type: keyof HiddenCalendars, id: string) => {
    setHidden((prev) => {
      const list = prev[type];
      const updated = {
        ...prev,
        [type]: list.includes(id)
          ? list.filter((x) => x !== id)
          : [...list, id],
      };
      save(updated);
      return updated;
    });
  }, []);

  const isHidden = useCallback(
    (type: keyof HiddenCalendars, id: string) => hidden[type].includes(id),
    [hidden],
  );

  return { hidden, toggle, isHidden };
}
