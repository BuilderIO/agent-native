type FilterSelection = string | string[] | undefined;

export function selectedFilterValues(value: FilterSelection): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(
    (entry) => entry !== "" && entry !== "all",
  );
}

export function toggleFilterValue(
  current: FilterSelection,
  value: string,
  multiple = false,
): string | string[] {
  const values = selectedFilterValues(current);
  if (!multiple) return values.includes(value) ? "" : value;
  const next = values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
  return next.length ? next : "";
}
