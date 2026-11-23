const placeholder = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function metricTitleInputs(title: string): string[] {
  return Array.from(title.matchAll(placeholder), ([, name]) => name).filter(
    (name): name is string => name !== undefined,
  );
}

export function renderMetricTitle(
  title: string,
  values?: ReadonlyMap<string, string>,
): string {
  return title.replace(
    placeholder,
    (token: string, name: string) => values?.get(name) ?? token,
  );
}
