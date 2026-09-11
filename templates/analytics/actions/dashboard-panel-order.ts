export type PanelOrderTarget =
  | { position: "top" | "bottom" }
  | { index: number }
  | { beforePanelId: string }
  | { afterPanelId: string };

export interface PanelOrderResult {
  panelCount: number;
  panelOrder: string[];
  firstPanelIds: string[];
  movedPanelIds: string[];
  missingPanelIds: string[];
  skippedDuplicatePanelIds: string[];
  insertIndex: number;
}

function panelsFromConfig(config: Record<string, unknown>) {
  const panels = config.panels;
  if (!Array.isArray(panels)) {
    throw new Error("config.panels must be an array");
  }
  return panels as Array<Record<string, unknown>>;
}

function panelId(panel: Record<string, unknown>): string {
  return typeof panel.id === "string" ? panel.id : "";
}

export function getPanelOrder(config: Record<string, unknown>): string[] {
  return panelsFromConfig(config).map(panelId).filter(Boolean);
}

export function getFirstPanelIds(
  config: Record<string, unknown>,
  count = 10,
): string[] {
  return getPanelOrder(config).slice(0, count);
}

function uniquePanelIds(ids: string[]): {
  ids: string[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const out: string[] = [];
  const duplicates: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (seen.has(id)) {
      duplicates.push(id);
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return { ids: out, duplicates };
}

function resolveInsertIndex(
  remainingPanels: Array<Record<string, unknown>>,
  target: PanelOrderTarget,
): number {
  if ("position" in target) {
    return target.position === "bottom" ? remainingPanels.length : 0;
  }
  if ("index" in target) {
    const index = target.index;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > remainingPanels.length
    ) {
      throw new Error(
        `index must be an integer between 0 and ${remainingPanels.length}`,
      );
    }
    return index;
  }

  const targetId =
    "beforePanelId" in target ? target.beforePanelId : target.afterPanelId;
  const index = remainingPanels.findIndex(
    (panel) => panelId(panel) === targetId,
  );
  if (index < 0) {
    throw new Error(`target panel "${targetId}" was not found`);
  }
  return "beforePanelId" in target ? index : index + 1;
}

export function movePanelsById(
  config: Record<string, unknown>,
  panelIds: string[],
  target: PanelOrderTarget = { position: "top" },
): PanelOrderResult {
  const panels = panelsFromConfig(config);
  const { ids, duplicates } = uniquePanelIds(panelIds);
  if (ids.length === 0) {
    throw new Error("panelIds must include at least one panel id");
  }

  const wanted = new Set(ids);
  const found = new Set<string>();
  const moving: Array<Record<string, unknown>> = [];
  const remaining: Array<Record<string, unknown>> = [];

  for (const panel of panels) {
    const id = panelId(panel);
    if (wanted.has(id)) {
      found.add(id);
      moving.push(panel);
    } else {
      remaining.push(panel);
    }
  }

  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`panel id(s) not found: ${missing.join(", ")}`);
  }

  const orderedMoving = ids.map(
    (id) => moving.find((panel) => panelId(panel) === id)!,
  );
  const insertIndex = resolveInsertIndex(remaining, target);
  const nextPanels = [
    ...remaining.slice(0, insertIndex),
    ...orderedMoving,
    ...remaining.slice(insertIndex),
  ];

  config.panels = nextPanels;
  const order = getPanelOrder(config);
  return {
    panelCount: order.length,
    panelOrder: order,
    firstPanelIds: order.slice(0, 10),
    movedPanelIds: ids,
    missingPanelIds: [],
    skippedDuplicatePanelIds: duplicates,
    insertIndex,
  };
}

export function applyPanelOrder(
  config: Record<string, unknown>,
  requestedPanelIds: string[],
): PanelOrderResult {
  return movePanelsById(config, requestedPanelIds, { position: "top" });
}

export function compactDashboardResult(
  config: Record<string, unknown>,
  movedPanelIds: string[] = [],
): {
  panelCount: number;
  panelOrder: string[];
  firstPanelIds: string[];
  movedPanelIds: string[];
} {
  const order = getPanelOrder(config);
  return {
    panelCount: order.length,
    panelOrder: order,
    firstPanelIds: order.slice(0, 10),
    movedPanelIds,
  };
}
