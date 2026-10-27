const DEVICE_ID_KEY = "clips:device-id";

// Used only when localStorage cannot hold the id, so it lasts for this window's
// lifetime. Keeping it stable matters more than persisting it.
let fallbackDeviceId: string | null = null;

// Identifies this install so the server can tell footage this device captured
// from footage captured elsewhere. Created on first use and then reused.
export function clipsDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && stored.trim()) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    fallbackDeviceId ??= crypto.randomUUID();
    return fallbackDeviceId;
  }
}
