import type { Cell } from "../app/lib/model/contracts.js";

export function linkedInputRange(cells: readonly Cell[], cell: Cell) {
  const input = cell.contents;
  if (
    input.kind !== "input" ||
    input.inputType !== "DROPDOWN" ||
    !input.rangeInputs
  )
    return null;
  const find = (name: string) =>
    cells.filter(
      ({ id, contents }) =>
        id !== cell.id &&
        contents.kind === "input" &&
        contents.name === name &&
        (contents.inputType === "DATE" || contents.inputType === "TEXT_INPUT"),
    );
  const start = find(input.rangeInputs.start);
  const end = find(input.rangeInputs.end);
  return start.length === 1 && end.length === 1
    ? { start: start[0]!, end: end[0]! }
    : null;
}

export function rangePresetUpdates(
  cell: Cell,
  range: NonNullable<ReturnType<typeof linkedInputRange>>,
  selected: string,
  values: Record<string, string>,
  today = new Date(),
) {
  const updates = [{ cell, value: selected }];
  if (cell.contents.kind !== "input") return updates;
  const days = cell.contents.rangeInputs?.initialDays;
  if (!days) return updates;
  const defaults = [range.start, range.end].map((bound) => ({
    cell: bound,
    value:
      bound.contents.kind === "input" ? bound.contents.defaultValueString : "",
  }));
  if (selected !== "custom") return [...updates, ...defaults];
  if (defaults.some(({ cell, value }) => (values[cell.id] ?? value) !== value))
    return updates;
  const firstDay = new Date(today);
  firstDay.setUTCDate(firstDay.getUTCDate() - days);
  return [
    ...updates,
    { cell: range.start, value: firstDay.toISOString().slice(0, 10) },
    { cell: range.end, value: today.toISOString().slice(0, 10) },
  ];
}
