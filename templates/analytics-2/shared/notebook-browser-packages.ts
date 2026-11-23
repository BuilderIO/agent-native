export const browserNotebookPackages = ["pyarrow", "pandas"] as const;

export function collectBrowserNotebookPackages<
  Package extends { depends: readonly string[] },
>(packages: Record<string, Package>) {
  const selected = new Map<string, Package>();
  function collect(name: string) {
    if (selected.has(name)) return;
    const entry = Object.hasOwn(packages, name) ? packages[name] : undefined;
    if (!entry)
      throw new Error(`Missing offline package in Pyodide lock: ${name}`);
    selected.set(name, entry);
    entry.depends.forEach(collect);
  }
  browserNotebookPackages.forEach(collect);
  return selected;
}
