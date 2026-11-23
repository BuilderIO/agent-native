import type {
  SettingsRowDefinition,
  SettingsRowId,
  Summary,
} from "./schema.js";

function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>>,
) {
  return template.replace(/\{([a-z]+)\}/g, (token, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : token,
  );
}

function indexRows(rows: readonly SettingsRowDefinition[]) {
  const indexed = new Map<SettingsRowId, SettingsRowDefinition>();
  function visit(children: readonly SettingsRowDefinition[]) {
    for (const row of children) {
      if (indexed.has(row.id))
        throw new Error(`Duplicate settings row: ${row.id}`);
      indexed.set(row.id, row);
      if (row.kind === "disclosure") visit(row.rows);
    }
  }
  visit(rows);
  return indexed;
}

export function resolveSettingsSummary(
  summary: Summary,
  owner: Extract<
    SettingsRowDefinition,
    { kind: "disclosure" | "checkbox-group" }
  >,
): string | undefined {
  const content = summary.content;
  const rows = indexRows(owner.kind === "disclosure" ? owner.rows : [owner]);
  function selection(id: SettingsRowId) {
    const row = rows.get(id);
    if (
      !row ||
      (row.kind !== "checkbox-group" && row.kind !== "multi-select")
    ) {
      throw new Error(`Expected settings selection row: ${id}`);
    }
    const read = row.binding.read;
    return read.status === "ready"
      ? { values: read.value, options: row.options }
      : undefined;
  }
  function enabled(id: SettingsRowId) {
    const row = rows.get(id);
    if (!row || (row.kind !== "checkbox" && row.kind !== "toggle")) {
      throw new Error(`Expected boolean settings row: ${id}`);
    }
    const read = row.binding.read;
    return read.status === "ready" ? read.value : undefined;
  }

  if (content.kind === "count") {
    const source = content.source;
    if (source.kind === "enabled-rows") {
      const values = source.rows.map(enabled);
      if (values.some((value) => value === undefined)) return;
      return interpolate(content.template, {
        count: values.filter(Boolean).length,
      });
    }
    const selected = selection(source.row === "self" ? owner.id : source.row);
    if (!selected) return;
    const values =
      source.scope === "stored"
        ? selected.values
        : selected.values.filter((value) =>
            selected.options.some((option) => option.value === value),
          );
    return interpolate(content.template, { count: values.length });
  }

  const active = enabled(content.enabledBy);
  if (active === undefined) return;
  if (!active) return content.disabled;
  const sources =
    typeof content.selectedOptionsFrom === "string"
      ? [content.selectedOptionsFrom]
      : content.selectedOptionsFrom;
  const labels = new Map<string, string>();
  const values = new Set<string>();
  for (const id of sources) {
    const selected = selection(id);
    if (!selected) return;
    for (const option of selected.options)
      labels.set(option.value, option.summaryLabel ?? option.label);
    for (const value of selected.values) values.add(value);
  }
  const names = [...values].flatMap((value) => {
    const label = content.optionLabels?.[value] ?? labels.get(value);
    if (!label) return [];
    return [
      content.list.labelCase === "lowercase" ? label.toLowerCase() : label,
    ];
  });
  if (!names.length) return content.none;
  if (names.length >= labels.size) return content.all;
  const { pair, separator, overflow } = content.list;
  const [first, second] = names;
  const fallback = pair?.useSeparatorIfLabelIncludes;
  const list =
    first &&
    second &&
    names.length === 2 &&
    pair &&
    (!fallback || !names.some((name) => name.includes(fallback)))
      ? interpolate(pair.template, { first, second })
      : names.length > overflow.maxNamed
        ? [
            ...names.slice(0, overflow.maxNamed),
            interpolate(overflow.template, {
              remaining: names.length - overflow.maxNamed,
            }),
          ].join(separator)
        : names.join(separator);
  return interpolate(content.partial, { list });
}
