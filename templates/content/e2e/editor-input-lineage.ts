export interface FixtureInputSnapshot {
  phase: "before-caret" | "before-input" | "after-input";
  edit: string;
  present: Record<string, number>;
  selectionCollapsed: boolean | null;
}

// This function is serialized into the fixture browser. Never return its text.
export function captureFixtureInput(args: {
  phase: FixtureInputSnapshot["phase"];
  text: string;
  editor: string;
}): FixtureInputSnapshot | null {
  const marker = /^\s*zq([a-f0-9]{4})([AB][1-9]\d{0,2})x\s*$/.exec(args.text);
  if (!marker) return null;
  const root = document.querySelector(args.editor);
  if (!root) return null;
  const present: Record<string, number> = {};
  const pattern = new RegExp(`zq${marker[1]}([AB][1-9]\\d{0,2})x`, "g");
  for (const match of (root.textContent ?? "").matchAll(pattern)) {
    if (!(match[1] in present) && Object.keys(present).length >= 32) continue;
    present[match[1]] = Math.min(32, (present[match[1]] ?? 0) + 1);
  }
  return {
    phase: args.phase,
    edit: marker[2],
    present,
    selectionCollapsed: window.getSelection()?.isCollapsed ?? null,
  };
}

export function parseFixtureInput(value: unknown): FixtureInputSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.phase !== "string" ||
    !["before-caret", "before-input", "after-input"].includes(data.phase) ||
    typeof data.edit !== "string" ||
    !/^[AB][1-9]\d{0,2}$/.test(data.edit) ||
    !data.present ||
    typeof data.present !== "object" ||
    Array.isArray(data.present) ||
    !(
      data.selectionCollapsed === null ||
      typeof data.selectionCollapsed === "boolean"
    )
  )
    return null;
  const entries = Object.entries(data.present);
  if (
    entries.length > 32 ||
    entries.some(
      ([key, count]) =>
        !/^[AB][1-9]\d{0,2}$/.test(key) ||
        !Number.isInteger(count) ||
        (count as number) < 1 ||
        (count as number) > 32,
    )
  )
    return null;
  return {
    phase: data.phase as FixtureInputSnapshot["phase"],
    edit: data.edit,
    present: Object.fromEntries(entries),
    selectionCollapsed: data.selectionCollapsed as boolean | null,
  };
}
