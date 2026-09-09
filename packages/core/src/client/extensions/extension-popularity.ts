import { useEffect, useState } from "react";

const EXTENSION_POPULARITY_KEY = "extensions-popularity:v1";
const EXTENSION_POPULARITY_CHANGE_EVENT = "extensions-popularity-change";

export type ExtensionPopularity = Record<string, number>;

function read(): ExtensionPopularity {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXTENSION_POPULARITY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(popularity: ExtensionPopularity): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EXTENSION_POPULARITY_KEY,
      JSON.stringify(popularity),
    );
  } catch {
    // localStorage unavailable — popularity is best-effort.
  }
  window.dispatchEvent(new Event(EXTENSION_POPULARITY_CHANGE_EVENT));
}

export function incrementExtensionView(id: string): void {
  if (!id) return;
  const popularity = read();
  popularity[id] = (popularity[id] ?? 0) + 1;
  write(popularity);
}

export function useExtensionPopularity(): ExtensionPopularity {
  const [snapshot, setSnapshot] = useState<ExtensionPopularity>(() => read());

  useEffect(() => {
    const refresh = () => setSnapshot(read());
    window.addEventListener(EXTENSION_POPULARITY_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EXTENSION_POPULARITY_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return snapshot;
}

export function extensionPopularityOf(
  popularity: ExtensionPopularity,
  id: string,
): number {
  return popularity[id] ?? 0;
}
