export const MIN_DASHBOARD_COLUMNS = 1;
export const MAX_DASHBOARD_COLUMNS = 6;
export const DEFAULT_DASHBOARD_COLUMNS = 2;

export interface DashboardLayoutPanel {
  id: string;
  width?: number;
  columns?: number;
}

export type DashboardPanelRow<TPanel extends DashboardLayoutPanel> = {
  key: string;
  panels: TPanel[];
};

export type DashboardPanelGroup<TPanel extends DashboardLayoutPanel> = {
  key: string;
  section: TPanel | null;
  panels: TPanel[];
  rows: DashboardPanelRow<TPanel>[];
  columns: number;
};

export type DashboardDropSlot =
  | { type: "row"; groupKey: string; rowIndex: number }
  | { type: "column"; groupKey: string; rowIndex: number; columnIndex: number };

export type DashboardColumnExpansion = {
  columns: number;
  sectionPanelId: string | null;
};

export type DashboardLayoutOptions<TPanel extends DashboardLayoutPanel> = {
  isSection?: (panel: TPanel) => boolean;
};

export function clampDashboardColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_DASHBOARD_COLUMNS;
  return Math.min(
    MAX_DASHBOARD_COLUMNS,
    Math.max(MIN_DASHBOARD_COLUMNS, Math.floor(value)),
  );
}

export function clampPanelWidth(value: unknown, gridColumns: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(
    clampDashboardColumns(gridColumns),
    Math.max(1, Math.floor(value)),
  );
}

export function rebalanceRowWidths<TPanel extends DashboardLayoutPanel>(
  panels: TPanel[],
  columns: number,
): TPanel[] {
  if (panels.length === 0) return [];
  const safeColumns = clampDashboardColumns(columns);
  const base = Math.max(1, Math.floor(safeColumns / panels.length));
  const remainder = safeColumns % panels.length;
  return panels.map((panel, index) => ({
    ...panel,
    width: base + (index < remainder ? 1 : 0),
  }));
}

export function buildDashboardRows<TPanel extends DashboardLayoutPanel>(
  panels: TPanel[],
  columns: number,
): DashboardPanelRow<TPanel>[] {
  const safeColumns = clampDashboardColumns(columns);
  const rows: DashboardPanelRow<TPanel>[] = [];
  let current: TPanel[] = [];
  let usedColumns = 0;
  const push = () => {
    if (!current.length) return;
    rows.push({
      key: current.map((panel) => panel.id).join(":") || `empty-${rows.length}`,
      panels: current,
    });
    current = [];
    usedColumns = 0;
  };
  for (const panel of panels) {
    const width = clampPanelWidth(panel.width, safeColumns);
    if (
      current.length &&
      (usedColumns + width > safeColumns || current.length >= safeColumns)
    )
      push();
    current.push(panel);
    usedColumns += width;
    if (usedColumns >= safeColumns || current.length >= safeColumns) push();
  }
  push();
  return rows;
}

export function buildDashboardPanelGroups<TPanel extends DashboardLayoutPanel>(
  panels: TPanel[],
  dashboardColumns: number,
  { isSection = () => false }: DashboardLayoutOptions<TPanel> = {},
): DashboardPanelGroup<TPanel>[] {
  const defaultColumns = clampDashboardColumns(dashboardColumns);
  const groups: DashboardPanelGroup<TPanel>[] = [];
  let current: Omit<DashboardPanelGroup<TPanel>, "rows"> = {
    key: "intro",
    section: null,
    panels: [],
    columns: defaultColumns,
  };
  const push = () => {
    if (!current.section && !current.panels.length) return;
    groups.push({
      ...current,
      rows: buildDashboardRows(current.panels, current.columns),
    });
  };
  for (const panel of panels) {
    if (isSection(panel)) {
      push();
      current = {
        key: panel.id,
        section: panel,
        panels: [],
        columns: clampDashboardColumns(panel.columns ?? defaultColumns),
      };
    } else {
      current.panels.push(panel);
    }
  }
  push();
  return groups;
}

function flattenGroups<TPanel extends DashboardLayoutPanel>(
  groups: DashboardPanelGroup<TPanel>[],
): TPanel[] {
  return groups.flatMap((group) => [
    ...(group.section ? [group.section] : []),
    ...group.rows.flatMap((row) =>
      rebalanceRowWidths(row.panels, group.columns),
    ),
  ]);
}

export function removePanelFromLayout<TPanel extends DashboardLayoutPanel>(
  panels: TPanel[],
  panelId: string,
  dashboardColumns: number,
  options?: DashboardLayoutOptions<TPanel>,
): TPanel[] {
  const groups = buildDashboardPanelGroups(panels, dashboardColumns, options);
  return flattenGroups(
    groups
      .map((group) => ({
        ...group,
        section: group.section?.id === panelId ? null : group.section,
        rows: group.rows
          .map((row) => ({
            ...row,
            panels: row.panels.filter((panel) => panel.id !== panelId),
          }))
          .filter((row) => row.panels.length),
      }))
      .filter((group) => group.section || group.rows.length),
  );
}

export function dropSlotId(slot: DashboardDropSlot): string {
  return slot.type === "row"
    ? `dashboard-drop:row:${slot.groupKey}:${slot.rowIndex}`
    : `dashboard-drop:column:${slot.groupKey}:${slot.rowIndex}:${slot.columnIndex}`;
}

export function readDropSlot(value: unknown): DashboardDropSlot | null {
  if (!value || typeof value !== "object") return null;
  const slot = (value as { slot?: unknown }).slot;
  if (!slot || typeof slot !== "object") return null;
  const candidate = slot as Partial<DashboardDropSlot>;
  if (
    candidate.type === "row" &&
    typeof candidate.groupKey === "string" &&
    typeof candidate.rowIndex === "number"
  ) {
    return {
      type: "row",
      groupKey: candidate.groupKey,
      rowIndex: candidate.rowIndex,
    };
  }
  if (
    candidate.type === "column" &&
    typeof candidate.groupKey === "string" &&
    typeof candidate.rowIndex === "number" &&
    typeof candidate.columnIndex === "number"
  ) {
    return {
      type: "column",
      groupKey: candidate.groupKey,
      rowIndex: candidate.rowIndex,
      columnIndex: candidate.columnIndex,
    };
  }
  return null;
}

export function sameDropSlot(
  a: DashboardDropSlot | null,
  b: DashboardDropSlot,
): boolean {
  return (
    !!a &&
    a.type === b.type &&
    a.groupKey === b.groupKey &&
    a.rowIndex === b.rowIndex &&
    (a.type === "row" ||
      (b.type === "column" && a.columnIndex === b.columnIndex))
  );
}

function findPanel<TPanel extends DashboardLayoutPanel>(
  groups: DashboardPanelGroup<TPanel>[],
  panelId: string,
) {
  for (const group of groups) {
    for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex++) {
      const columnIndex = group.rows[rowIndex].panels.findIndex(
        (panel) => panel.id === panelId,
      );
      if (columnIndex >= 0) return { group, rowIndex, columnIndex };
    }
  }
  return null;
}

export function columnExpansionForDropSlot<TPanel extends DashboardLayoutPanel>(
  groups: DashboardPanelGroup<TPanel>[],
  panelId: string,
  slot: DashboardDropSlot,
): DashboardColumnExpansion | null {
  if (slot.type !== "column") return null;
  const group = groups.find((item) => item.key === slot.groupKey);
  const row = group?.rows[slot.rowIndex];
  if (!group || !row) return null;
  const required = row.panels.some((panel) => panel.id === panelId)
    ? row.panels.length
    : row.panels.length + 1;
  return required > group.columns
    ? {
        columns: clampDashboardColumns(required),
        sectionPanelId: group.section?.id ?? null,
      }
    : null;
}

/** Moves a panel by visible row/column slot and rebalances persisted widths. */
export function movePanelToDropSlot<TPanel extends DashboardLayoutPanel>(
  panels: TPanel[],
  panelId: string,
  slot: DashboardDropSlot,
  dashboardColumns: number,
  options?: DashboardLayoutOptions<TPanel>,
): TPanel[] {
  const groups = buildDashboardPanelGroups(panels, dashboardColumns, options);
  const source = findPanel(groups, panelId);
  if (!source) return panels;
  const moving = source.group.rows[source.rowIndex].panels[source.columnIndex];
  const sourceWasSingle =
    source.group.rows[source.rowIndex].panels.length === 1;
  const next = groups.map((group) => ({
    ...group,
    rows: group.rows
      .map((row) => ({
        ...row,
        panels: row.panels.filter((panel) => panel.id !== panelId),
      }))
      .filter((row) => row.panels.length),
  }));
  const target = next.find((group) => group.key === slot.groupKey);
  if (!target) return panels;
  if (slot.type === "row") {
    let rowIndex = slot.rowIndex;
    if (
      source.group.key === target.key &&
      sourceWasSingle &&
      source.rowIndex < rowIndex
    )
      rowIndex--;
    if (
      source.group.key === target.key &&
      sourceWasSingle &&
      source.rowIndex === rowIndex
    )
      return panels;
    target.rows.splice(Math.max(0, rowIndex), 0, {
      key: moving.id,
      panels: [moving],
    });
  } else {
    let rowIndex = slot.rowIndex;
    if (
      source.group.key === target.key &&
      sourceWasSingle &&
      source.rowIndex < rowIndex
    )
      rowIndex--;
    const targetRow = target.rows[rowIndex];
    if (!targetRow) return panels;
    let columnIndex = slot.columnIndex;
    if (
      source.group.key === target.key &&
      source.rowIndex === slot.rowIndex &&
      source.columnIndex < columnIndex
    )
      columnIndex--;
    targetRow.panels.splice(
      Math.max(0, Math.min(columnIndex, targetRow.panels.length)),
      0,
      moving,
    );
    target.columns = Math.max(
      target.columns,
      clampDashboardColumns(targetRow.panels.length),
    );
  }
  return flattenGroups(next);
}
