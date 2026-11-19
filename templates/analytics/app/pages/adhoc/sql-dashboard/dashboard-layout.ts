import {
  clampDashboardColumns,
  clampPanelWidth,
  MAX_DASHBOARD_COLUMNS,
  type SqlPanel,
} from "@agent-native/toolkit/dashboard/sql-dashboard-types";

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

export type DashboardDropSlotCandidate = {
  id: string;
  slot: DashboardDropSlot;
  rect: DashboardClientRect;
};

export type DashboardColumnExpansion = {
  columns: number;
  sectionPanelId: string | null;
};

const COLUMN_SLOT_EDGE_PROXIMITY_PX = 48;

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

function pointerIsInsideRect(
  pointer: DashboardPointerCoordinates,
  rect: DashboardClientRect,
): boolean {
  return (
    pointer.x >= rect.left &&
    pointer.x <= rect.right &&
    pointer.y >= rect.top &&
    pointer.y <= rect.bottom
  );
}

function pointerIsHorizontallyInsideRect(
  pointer: DashboardPointerCoordinates,
  rect: DashboardClientRect,
): boolean {
  return pointer.x >= rect.left && pointer.x <= rect.right;
}

function closestDropSlotCandidate(
  pointer: DashboardPointerCoordinates,
  candidates: DashboardDropSlotCandidate[],
): { candidate: DashboardDropSlotCandidate; distance: number } | null {
  let closest: DashboardDropSlotCandidate | null = null;
  let closestDistance = Number.MAX_VALUE;

  for (const candidate of candidates) {
    const distance = distanceFromPointerToRect(pointer, candidate.rect);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest ? { candidate: closest, distance: closestDistance } : null;
}

export function preferredDropSlotId(
  pointer: DashboardPointerCoordinates,
  candidates: DashboardDropSlotCandidate[],
): string | null {
  if (candidates.length === 0) return null;

  const columnSlotsUnderPointerX = candidates.filter(
    (candidate) =>
      candidate.slot.type === "column" &&
      pointerIsHorizontallyInsideRect(pointer, candidate.rect),
  );
  const closestColumnSlot = closestDropSlotCandidate(
    pointer,
    columnSlotsUnderPointerX,
  );
  if (
    closestColumnSlot &&
    closestColumnSlot.distance <= COLUMN_SLOT_EDGE_PROXIMITY_PX
  ) {
    return closestColumnSlot.candidate.id;
  }

  const containingSlots = candidates.filter((candidate) =>
    pointerIsInsideRect(pointer, candidate.rect),
  );
  const closestContainingSlot = closestDropSlotCandidate(
    pointer,
    containingSlots,
  );
  if (closestContainingSlot) return closestContainingSlot.candidate.id;

  return closestDropSlotCandidate(pointer, candidates)?.candidate.id ?? null;
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

/** Whether `panels` still lay out as one row of their own, with `next` after them. */
function laysOutAsOneRow(
  panels: SqlPanel[],
  next: SqlPanel | undefined,
  columns: number,
): boolean {
  // Packing is greedy, so a panel after them can join their row or start the
  // next one, but never changes how they split.
  if (buildDashboardRows(panels, columns).length !== 1) return false;
  return !next || buildDashboardRows([...panels, next], columns).length === 2;
}

/**
 * Lays the rows back out as a panel list. Each row in `reflowedRows` (one a
 * panel left or joined, one whose group changed its column count, or one a
 * removed section handed to the group before it) is rebalanced to fill its
 * group. Every other row keeps its widths, so placing a
 * panel never resizes panels elsewhere on the dashboard, unless those widths
 * would no longer lay out as the same row: the panel that kept the row apart
 * from the next one has left, say.
 */
function flattenGroups(
  groups: DashboardPanelGroup[],
  reflowedRows: ReadonlySet<DashboardPanelRow>,
): SqlPanel[] {
  return groups.flatMap((group) => {
    const panels: SqlPanel[] = [];
    // Bottom up, so each row is checked against the final width of the panel
    // after it. A group's last row ends at the next section.
    let next: SqlPanel | undefined;
    for (const row of [...group.rows].reverse()) {
      const laidOut =
        reflowedRows.has(row) ||
        !laysOutAsOneRow(row.panels, next, group.columns)
          ? rebalanceRowWidths(row.panels, group.columns)
          : row.panels;
      panels.unshift(...laidOut);
      next = laidOut[0];
    }
    return group.section ? [group.section, ...panels] : panels;
  });
}

export function removePanelFromLayout(
  panels: SqlPanel[],
  panelId: string,
  dashboardColumns: number,
): SqlPanel[] {
  const reflowedRows = new Set<DashboardPanelRow>();
  const nextGroups: DashboardPanelGroup[] = [];

  for (const group of buildDashboardPanelGroups(panels, dashboardColumns)) {
    const rows = group.rows
      .map((row) => {
        const next = {
          ...row,
          panels: row.panels.filter((panel) => panel.id !== panelId),
        };
        if (next.panels.length !== row.panels.length) reflowedRows.add(next);
        return next;
      })
      .filter((row) => row.panels.length > 0);
    if (group.section?.id !== panelId) {
      if (group.section || rows.length > 0) nextGroups.push({ ...group, rows });
      continue;
    }

    // A removed section's rows join the group before it, on that group's
    // grid, split where a row holds more panels than it has columns.
    const receiving = nextGroups.pop() ?? {
      key: "intro",
      section: null,
      panels: [],
      rows: [],
      columns: clampDashboardColumns(dashboardColumns),
    };
    nextGroups.push(receiving);
    for (const row of rows) {
      for (
        let start = 0;
        start < row.panels.length;
        start += receiving.columns
      ) {
        const joined = {
          key: `${row.key}:${start}`,
          panels: row.panels.slice(start, start + receiving.columns),
        };
        receiving.rows.push(joined);
        reflowedRows.add(joined);
      }
    }
  }

  return flattenGroups(nextGroups, reflowedRows);
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

  return row.panels.length < MAX_DASHBOARD_COLUMNS;
}

export function availableDropSlotIdsForPanel(
  groups: DashboardPanelGroup[],
  panelId: string,
): Set<string> {
  const ids = new Set<string>();
  if (!panelIsInRenderedRow(groups, panelId)) return ids;

  for (const group of groups) {
    for (let rowIndex = 0; rowIndex <= group.rows.length; rowIndex++) {
      ids.add(dropSlotId({ type: "row", groupKey: group.key, rowIndex }));
    }

    for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex++) {
      const row = group.rows[rowIndex];
      const rowContainsPanel = row.panels.some((panel) => panel.id === panelId);
      if (!rowContainsPanel && row.panels.length >= MAX_DASHBOARD_COLUMNS) {
        continue;
      }
      if (rowContainsPanel && row.panels.length <= 1) continue;

      for (
        let columnIndex = 0;
        columnIndex <= row.panels.length;
        columnIndex++
      ) {
        ids.add(
          dropSlotId({
            type: "column",
            groupKey: group.key,
            rowIndex,
            columnIndex,
          }),
        );
      }
    }
  }

  return ids;
}

export function columnExpansionForDropSlot(
  groups: DashboardPanelGroup[],
  panelId: string,
  slot: DashboardDropSlot,
): DashboardColumnExpansion | null {
  if (slot.type !== "column") return null;

  const group = groups.find((item) => item.key === slot.groupKey);
  const row = group?.rows[slot.rowIndex];
  if (!group || !row) return null;

  const rowContainsPanel = row.panels.some((panel) => panel.id === panelId);
  const requiredColumns = rowContainsPanel
    ? row.panels.length
    : row.panels.length + 1;
  if (requiredColumns <= group.columns) return null;

  return {
    columns: clampDashboardColumns(requiredColumns),
    sectionPanelId: group.section?.id ?? null,
  };
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

  const reflowedRows = new Set<DashboardPanelRow>();
  const nextGroups = groups.map((group) => ({
    ...group,
    rows: group.rows
      .map((row) => {
        const next = {
          ...row,
          panels: row.panels.filter((panel) => panel.id !== panelId),
        };
        if (next.panels.length !== row.panels.length) reflowedRows.add(next);
        return next;
      })
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
    if (
      sourceGroupKey === slot.groupKey &&
      sourceRowWasSingle &&
      sourceRowIndex === rowIndex
    ) {
      return panels;
    }
    const newRow = { key: movingPanel.id, panels: [movingPanel] };
    targetGroup.rows.splice(Math.max(0, rowIndex), 0, newRow);
    reflowedRows.add(newRow);
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
    reflowedRows.add(targetRow);
    const columns = Math.max(
      targetGroup.columns,
      clampDashboardColumns(targetRow.panels.length),
    );
    // A group that gains a column lays every row out on the wider grid.
    if (columns !== targetGroup.columns) {
      // Widening the rows above the first section widens the dashboard, and
      // sections without their own column count follow it; pin them to the
      // count they have now, so their rows stay as they are.
      if (!targetGroup.section) {
        for (const group of nextGroups) {
          if (group.section && group.section.columns == null) {
            group.section = { ...group.section, columns: group.columns };
          }
        }
      }
      targetGroup.columns = columns;
      for (const row of targetGroup.rows) reflowedRows.add(row);
    }
  }

  return flattenGroups(nextGroups, reflowedRows);
}
