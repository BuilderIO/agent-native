export function loadString(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    if (v && v.trim()) return v;
  } catch {
    // ignore
  }
  return fallback;
}

export function loadStringAllowEmpty(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // ignore
  }
  return fallback;
}

export function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    // ignore
  }
  return fallback;
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // non-fatal
  }
}

export function saveBool(key: string, value: boolean): void {
  saveString(key, value ? "1" : "0");
}
