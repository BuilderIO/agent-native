import {
  SETTINGS_ROW_ID_PATTERN,
  type SettingsRowDefinition,
  type SettingsRowId,
  type SettingsRowKind,
  type SettingsSectionDefinition,
  type SettingsSummary,
} from "./schema.js";

const SECTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSettingsRowVisible(row: SettingsRowDefinition): boolean {
  return row.condition?.visible !== false;
}

export function childSettingsRows(
  row: SettingsRowDefinition,
): readonly SettingsRowDefinition[] {
  return row.kind === "disclosure" || row.kind === "group" ? row.rows : [];
}

/** Every visible row, parents before children, in render order. */
export function flattenSettingsRows(
  sections: readonly SettingsSectionDefinition[],
): SettingsRowDefinition[] {
  const out: SettingsRowDefinition[] = [];
  const walk = (rows: readonly SettingsRowDefinition[]) => {
    for (const row of rows) {
      if (!isSettingsRowVisible(row)) continue;
      out.push(row);
      walk(childSettingsRows(row));
    }
  };
  for (const section of sections) walk(section.rows);
  return out;
}

/**
 * Checks ids and summary references. Returns the problems found; an empty list
 * means the sections are well formed. Hidden rows are checked too, so a page
 * cannot hide a malformed row behind a condition.
 */
export function validateSettingsSections(
  sections: readonly SettingsSectionDefinition[],
): string[] {
  const problems: string[] = [];
  const sectionIds = new Set<string>();
  const rowIds = new Set<string>();
  const check = (
    rows: readonly SettingsRowDefinition[],
    siblings: readonly SettingsRowDefinition[],
  ) => {
    for (const row of rows) {
      if (!SETTINGS_ROW_ID_PATTERN.test(row.id)) {
        problems.push(`Row id is not a settings row id: ${row.id}`);
      }
      if (rowIds.has(row.id)) problems.push(`Duplicate row id: ${row.id}`);
      rowIds.add(row.id);
      if (row.kind === "custom" && !row.reason.trim()) {
        problems.push(`Custom row ${row.id} needs a reason`);
      }
      const summary =
        row.kind === "disclosure"
          ? row.summary
          : row.kind === "checkbox-group"
            ? row.disclosure?.summary
            : undefined;
      if (summary) {
        const scope = row.kind === "disclosure" ? row.rows : siblings;
        for (const problem of summaryProblems(row, summary, scope)) {
          problems.push(problem);
        }
      }
      const children = childSettingsRows(row);
      if (children.length > 0) check(children, children);
    }
  };
  for (const section of sections) {
    if (!SECTION_ID_PATTERN.test(section.id)) {
      problems.push(
        `Section id is not lowercase and hyphenated: ${section.id}`,
      );
    }
    if (sectionIds.has(section.id)) {
      problems.push(`Duplicate section id: ${section.id}`);
    }
    sectionIds.add(section.id);
    check(section.rows, section.rows);
  }
  return problems;
}

function findRow(
  rows: readonly SettingsRowDefinition[],
  id: SettingsRowId,
): SettingsRowDefinition | undefined {
  for (const row of rows) {
    if (row.id === id) return row;
    const nested = findRow(childSettingsRows(row), id);
    if (nested) return nested;
  }
  return undefined;
}

function summaryProblems(
  owner: SettingsRowDefinition,
  summary: SettingsSummary,
  scope: readonly SettingsRowDefinition[],
): string[] {
  const problems: string[] = [];
  const need = (id: SettingsRowId, kinds: readonly SettingsRowKind[]) => {
    const row = findRow(scope, id);
    if (!row) {
      problems.push(`Summary of ${owner.id} refers to a missing row: ${id}`);
    } else if (!kinds.includes(row.kind)) {
      problems.push(
        `Summary of ${owner.id} needs ${id} to be ${kinds.join(" or ")}, found ${row.kind}`,
      );
    }
  };
  const content = summary.content;
  if (content.kind === "count") {
    if (content.source.kind === "selected-options") {
      if (content.source.row === "self") {
        if (owner.kind !== "checkbox-group") {
          problems.push(
            `Summary of ${owner.id} counts its own options but is not a checkbox group`,
          );
        }
      } else {
        need(content.source.row, ["checkbox-group", "multi-select"]);
      }
    } else {
      for (const id of content.source.rows) need(id, ["toggle", "checkbox"]);
    }
  } else {
    need(content.enabledBy, ["toggle", "checkbox"]);
    const from = content.selectedOptionsFrom;
    for (const id of typeof from === "string" ? [from] : from) {
      need(id, ["checkbox-group", "multi-select"]);
    }
  }
  return problems;
}

/**
 * The text a disclosure or collapsible checkbox group shows beside its label.
 * Returns `null` when the summary cannot be derived, so a skin never shows a
 * false zero.
 */
export function deriveSettingsSummary(
  owner: SettingsRowDefinition,
  summary: SettingsSummary,
  scope: readonly SettingsRowDefinition[],
): string | null {
  const content = summary.content;
  if (content.kind === "count") {
    let count: number;
    if (content.source.kind === "selected-options") {
      const row =
        content.source.row === "self"
          ? owner
          : findRow(scope, content.source.row);
      if (
        !row ||
        (row.kind !== "checkbox-group" && row.kind !== "multi-select")
      ) {
        return null;
      }
      count = row.binding.value.length;
    } else {
      count = 0;
      for (const id of content.source.rows) {
        const row = findRow(scope, id);
        if (!row || (row.kind !== "toggle" && row.kind !== "checkbox")) {
          return null;
        }
        if (row.binding.value) count += 1;
      }
    }
    return content.template.replace("{count}", String(count));
  }

  const enabledBy = findRow(scope, content.enabledBy);
  if (
    !enabledBy ||
    (enabledBy.kind !== "toggle" && enabledBy.kind !== "checkbox")
  ) {
    return null;
  }
  const fromIds =
    typeof content.selectedOptionsFrom === "string"
      ? [content.selectedOptionsFrom]
      : content.selectedOptionsFrom;
  const labels = new Map<string, string>();
  const selected: string[] = [];
  let offered = 0;
  for (const id of fromIds) {
    const from = findRow(scope, id);
    if (
      !from ||
      (from.kind !== "checkbox-group" && from.kind !== "multi-select")
    ) {
      return null;
    }
    offered += from.options.length;
    for (const option of from.options) labels.set(option.value, option.label);
    for (const value of from.binding.value) {
      if (!selected.includes(value)) selected.push(value);
    }
  }
  if (!enabledBy.binding.value) return content.disabled;
  for (const [value, label] of Object.entries(content.optionLabels ?? {})) {
    if (!labels.has(value)) labels.set(value, label);
  }
  const names = selected
    .map((value) => labels.get(value))
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    .map((name) =>
      content.list.labelCase === "lowercase" ? name.toLowerCase() : name,
    );
  if (names.length === 0) return content.none;
  if (names.length >= (content.allCount ?? offered)) return content.all;
  const { separator, pair, overflow } = content.list;
  let list: string;
  if (names.length === 1) {
    list = names.join(separator);
  } else if (names.length === 2) {
    const [first = "", second = ""] = names;
    const avoid = pair?.useSeparatorIfLabelIncludes;
    const usePair =
      pair && !(avoid && names.some((name) => name.includes(avoid)));
    list = usePair
      ? pair.template.replace("{first}", first).replace("{second}", second)
      : names.join(separator);
  } else {
    const named = names.slice(0, overflow.maxNamed);
    const remaining = names.length - named.length;
    list = [
      ...named,
      overflow.template.replace("{remaining}", String(remaining)),
    ].join(separator);
  }
  return content.partial.replace("{list}", list);
}

export interface SettingsCoverage {
  /** Rows rendered from data by the shared part. */
  covered: number;
  /** Rows that are app-rendered slots. */
  custom: number;
  total: number;
  byKind: Readonly<Record<string, number>>;
  customRows: readonly { id: string; reason: string }[];
  /** Layout hints in use, with the number of sections and rows using each. */
  hints: Readonly<Record<string, number>>;
}

/**
 * Counts one row per labeled unit. A group or
 * disclosure counts once, and so does each row inside it. Hidden rows are
 * counted, because coverage is a property of the page, not of one viewer.
 */
export function settingsCoverage(
  sections: readonly SettingsSectionDefinition[],
): SettingsCoverage {
  const byKind: Record<string, number> = {};
  const hints: Record<string, number> = {};
  const customRows: { id: string; reason: string }[] = [];
  let total = 0;
  const noteHints = (bag: Readonly<Record<string, unknown>> | undefined) => {
    for (const key of Object.keys(bag ?? {}))
      hints[key] = (hints[key] ?? 0) + 1;
  };
  const walk = (rows: readonly SettingsRowDefinition[]) => {
    for (const row of rows) {
      total += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      noteHints(row.hints);
      if (row.kind === "custom") {
        customRows.push({ id: row.id, reason: row.reason });
      }
      walk(childSettingsRows(row));
    }
  };
  for (const section of sections) {
    noteHints(section.hints);
    walk(section.rows);
  }
  return {
    covered: total - customRows.length,
    custom: customRows.length,
    total,
    byKind,
    customRows,
    hints,
  };
}

export function mergeSettingsCoverage(
  parts: readonly SettingsCoverage[],
): SettingsCoverage {
  const byKind: Record<string, number> = {};
  const hints: Record<string, number> = {};
  const customRows: { id: string; reason: string }[] = [];
  let total = 0;
  for (const part of parts) {
    total += part.total;
    customRows.push(...part.customRows);
    for (const [kind, count] of Object.entries(part.byKind)) {
      byKind[kind] = (byKind[kind] ?? 0) + count;
    }
    for (const [hint, count] of Object.entries(part.hints)) {
      hints[hint] = (hints[hint] ?? 0) + count;
    }
  }
  return {
    covered: total - customRows.length,
    custom: customRows.length,
    total,
    byKind,
    customRows,
    hints,
  };
}
