/**
 * Choices for a dropdown or multiselect whose values come from a column of an
 * earlier query result. Shared by the notebook controls and the server runs so
 * both read one definition of "an allowed value".
 */

export type OptionSource = {
  dataframe: string;
  valueColumn: string;
  labelColumn?: string | null | undefined;
};

export type OptionFrame = {
  columns: ReadonlyArray<{ name: string }>;
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>;
  /** False when the saved result holds only part of the query's rows. */
  complete: boolean;
};

export type TypedOption = {
  value: string | number;
  /** Stored form of the value in an input: the string a run binds. */
  text: string;
  label: string | null;
};

export type ResolvedOptions =
  | { status: "ready"; options: TypedOption[]; incomplete: boolean }
  | { status: "pending" }
  | { status: "missingColumn"; column: string }
  /** The column holds both a number and a string that print the same. */
  | { status: "ambiguous"; text: string };

/**
 * Distinct non-null strings and numbers, in first-seen order. Strings and
 * numbers stay different values, and every lookup is by own key, so a value
 * named like an inherited property is still a value.
 */
export function resolveOptions(
  source: OptionSource,
  frame: OptionFrame | null,
): ResolvedOptions {
  if (frame == null) return { status: "pending" };
  const valueIndex = frame.columns.findIndex(
    (column) => column.name === source.valueColumn,
  );
  if (valueIndex < 0) {
    return { status: "missingColumn", column: source.valueColumn };
  }
  let labelIndex = -1;
  if (source.labelColumn != null) {
    labelIndex = frame.columns.findIndex(
      (column) => column.name === source.labelColumn,
    );
    if (labelIndex < 0) {
      return { status: "missingColumn", column: source.labelColumn };
    }
  }
  const seen = new Map<string, TypedOption>();
  const kinds = new Map<string, "string" | "number">();
  for (const row of frame.rows) {
    const raw = row[valueIndex];
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    if (typeof raw === "number" && !Number.isFinite(raw)) continue;
    const text = String(raw);
    const kind = typeof raw === "number" ? "number" : "string";
    const previous = kinds.get(text);
    if (previous !== undefined && previous !== kind) {
      return { status: "ambiguous", text };
    }
    if (previous !== undefined) continue;
    kinds.set(text, kind);
    const label = labelIndex >= 0 ? row[labelIndex] : null;
    seen.set(text, {
      value: raw,
      text,
      label: label == null ? null : String(label),
    });
  }
  return {
    status: "ready",
    options: [...seen.values()],
    incomplete: !frame.complete,
  };
}
