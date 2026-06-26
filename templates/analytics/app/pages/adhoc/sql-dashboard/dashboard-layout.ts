import { clampDashboardColumns, clampPanelWidth, type SqlPanel } from "./types";

export type DashboardPanelRow = {
  key: string;
  panels: SqlPanel[];
};

export type DashboardPanelGroup = {
  key: string;
  section: SqlPanel | null;
  panels: SqlPanel[];
  rows: DashboardPanelRow[];
  columns: number;
};

export type DashboardDropSlot =
  | {
      type: "row";
      groupKey: string;
      rowIndex: number;
    }
  | {
      type: "column";
      groupKey: string;
      rowIndex: number;
      columnIndex: number;
    };

export type DashboardPointerCoordinates = {
  x: number;
  y: number;
};

export type DashboardClientRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function rowKey(panels: SqlPanel[], index: number): string {
  return panels.map((panel) => panel.id).join(":") || `empty-${index}`;
}

export function distanceFromPointerToRect(
  pointer: DashboardPointerCoordinates,
  rect: DashboardClientRect,
): number {
  const dx =
    pointer.x < rect.left
      ? rect.left - pointer.x
      : pointer.x > rect.right
        ? pointer.x - rect.right
        : 0;
  const dy =
    pointer.y < rect.top
      ? rect.top - pointer.y
      : pointer.y > rect.bottom
        ? pointer.y - rect.bottom
        : 0;

  return Math.hypot(dx, dy);
}

export function rebalanceRowWidths(
  panels: SqlPanel[],
  columns: number,
): SqlPanel[] {
  if (panels.length === 0) return [];

  const safeColumns = clampDashboardColumns(columns);
  const base = Math.max(1, Math.floor(safeColumns / panels.length));
  const remainder = safeColumns % panels.length;

  return panels.map((panel, index) => ({
    ...panel,
    width: base + (index < remainder ? 1 : 0),
  }));
}

export function buildDashboardRows(
  panels: SqlPanel[],
  columns: number,
): DashboardPanelRow[] {
  const safeColumns = clampDashboardColumns(columns);
  const rows: DashboardPanelRow[] = [];
  let current: SqlPanel[] = [];
  let usedColumns = 0;

  const pushCurrent = () => {
    if (current.length === 0) return;
    rows.push({
      key: rowKey(current, rows.length),
      panels: current,
    });
    current = [];
    usedColumns = 0;
  };

  for (const panel of panels) {
    const width = clampPanelWidth(panel.width, safeColumns);
    if (
      current.length > 0 &&
      (usedColumns + width > safeColumns || current.length >= safeColumns)
    ) {
      pushCurrent();
    }

    current.push(panel);
    usedColumns += width;

    if (usedColumns >= safeColumns || current.length >= safeColumns) {
      pushCurrent();
    }
  }

  pushCurrent();
  return rows;
}

export function buildDashboardPanelGroups(
  panels: SqlPanel[],
  dashboardColumns: number,
): DashboardPanelGroup[] {
  const defaultColumns = clampDashboardColumns(dashboardColumns);
  const groups: DashboardPanelGroup[] = [];
  let current: Omit<DashboardPanelGroup, "rows"> = {
    key: "intro",
    section: null,
    panels: [],
    columns: defaultColumns,
  };

  const pushCurrent = () => {
    if (!current.section && current.panels.length === 0) return;
    groups.push({
      ...current,
      rows: buildDashboardRows(current.panels, current.columns),
    });
  };

  for (const panel of panels) {
    if (panel.chartType === "section") {
      pushCurrent();
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

  pushCurrent();
  return groups;
}

function flattenGroups(groups: DashboardPanelGroup[]): SqlPanel[] {
  return groups.flatMap((group) => [
    ...(group.section ? [group.section] : []),
    ...group.rows.flatMap((row) =>
      rebalanceRowWidths(row.panels, group.columns),
    ),
  ]);
}

export function removePanelFromLayout(
  panels: SqlPanel[],
  panelId: string,
  dashboardColumns: number,
): SqlPanel[] {
  const groups = buildDashboardPanelGroups(panels, dashboardColumns);

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
          .filter((row) => row.panels.length > 0),
      }))
      .filter((group) => group.section || group.rows.length > 0),
  );
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

function panelIsInRenderedRow(
  groups: DashboardPanelGroup[],
  panelId: string,
): boolean {
  return groups.some((group) =>
    group.rows.some((row) => row.panels.some((panel) => panel.id === panelId)),
  );
}

export function isDropSlotAvailable(
  groups: DashboardPanelGroup[],
  panelId: string,
  slot: DashboardDropSlot,
): boolean {
  if (!panelIsInRenderedRow(groups, panelId)) return false;

  const group = groups.find((item) => item.key === slot.groupKey);
  if (!group) return false;

  if (slot.type === "row") {
    return slot.rowIndex >= 0 && slot.rowIndex <= group.rows.length;
  }

  const row = group.rows[slot.rowIndex];
  if (!row) return false;
  if (slot.columnIndex < 0 || slot.columnIndex > row.panels.length) {
    return false;
  }

  const rowContainsPanel = row.panels.some((panel) => panel.id === panelId);
  if (rowContainsPanel) return row.panels.length > 1;

  return row.panels.length < group.columns;
}

export function movePanelToDropSlot(
  panels: SqlPanel[],
  panelId: string,
  slot: DashboardDropSlot,
  dashboardColumns: number,
): SqlPanel[] {
  const groups = buildDashboardPanelGroups(panels, dashboardColumns);
  let movingPanel: SqlPanel | null = null;
  let sourceGroupKey: string | null = null;
  let sourceRowIndex = -1;
  let sourceColumnIndex = -1;
  let sourceRowWasSingle = false;

  for (const group of groups) {
    for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex++) {
      const row = group.rows[rowIndex];
      const columnIndex = row.panels.findIndex((panel) => panel.id === panelId);
      if (columnIndex >= 0) {
        movingPanel = row.panels[columnIndex];
        sourceGroupKey = group.key;
        sourceRowIndex = rowIndex;
        sourceColumnIndex = columnIndex;
        sourceRowWasSingle = row.panels.length === 1;
        break;
      }
    }
    if (movingPanel) break;
  }

  if (!movingPanel) return panels;

  const nextGroups = groups.map((group) => ({
    ...group,
    rows: group.rows
      .map((row) => ({
        ...row,
        panels: row.panels.filter((panel) => panel.id !== panelId),
      }))
      .filter((row) => row.panels.length > 0),
  }));
  const targetGroup = nextGroups.find((group) => group.key === slot.groupKey);
  if (!targetGroup) return panels;

  if (slot.type === "row") {
    let rowIndex = slot.rowIndex;
    if (
      sourceGroupKey === slot.groupKey &&
      sourceRowWasSingle &&
      sourceRowIndex < rowIndex
    ) {
      rowIndex -= 1;
    }
    targetGroup.rows.splice(Math.max(0, rowIndex), 0, {
      key: movingPanel.id,
      panels: [movingPanel],
    });
  } else {
    let rowIndex = slot.rowIndex;
    if (
      sourceGroupKey === slot.groupKey &&
      sourceRowWasSingle &&
      sourceRowIndex === rowIndex
    ) {
      return panels;
    }

    if (
      sourceGroupKey === slot.groupKey &&
      sourceRowWasSingle &&
      sourceRowIndex < rowIndex
    ) {
      rowIndex -= 1;
    }

    const targetRow = targetGroup.rows[rowIndex];
    if (!targetRow) return panels;

    let columnIndex = slot.columnIndex;
    if (
      sourceGroupKey === slot.groupKey &&
      sourceRowIndex === slot.rowIndex &&
      sourceColumnIndex < columnIndex
    ) {
      columnIndex -= 1;
    }

    targetRow.panels.splice(
      Math.max(0, Math.min(columnIndex, targetRow.panels.length)),
      0,
      movingPanel,
    );
  }

  return flattenGroups(nextGroups);
}
