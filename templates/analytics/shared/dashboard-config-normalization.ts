const PANEL_FIELDS = [
  "title",
  "sql",
  "source",
  "chartType",
  "width",
  "tab",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Repairs the legacy shape where panel fields were accidentally saved inside
 * `panel.config`. Renderer options such as `config.columns` stay nested.
 */
export function normalizeDashboardConfig<T>(config: T): T {
  if (!isRecord(config)) return config;
  if (!Array.isArray(config.panels)) return config;

  let changed = false;
  const panels = config.panels.map((value) => {
    if (!isRecord(value) || !isRecord(value.config)) return value;

    const nextConfig = { ...value.config };
    const nextPanel = { ...value };
    let panelChanged = false;

    for (const field of PANEL_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(nextConfig, field)) continue;
      nextPanel[field] = nextConfig[field];
      delete nextConfig[field];
      panelChanged = true;
    }

    if (
      (nextPanel.chartType === "section" ||
        nextConfig.chartType === "section") &&
      typeof nextConfig.columns === "number" &&
      Number.isFinite(nextConfig.columns)
    ) {
      nextPanel.columns = nextConfig.columns;
      delete nextConfig.columns;
      panelChanged = true;
    }

    if (!panelChanged) return value;
    changed = true;
    if (Object.keys(nextConfig).length > 0) nextPanel.config = nextConfig;
    else delete nextPanel.config;
    return nextPanel;
  });

  return (changed ? { ...config, panels } : config) as T;
}
