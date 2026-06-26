import { movePanelsById, type PanelOrderTarget } from "./dashboard-panel-order";

export const DASHBOARD_MUTATION_API_TYPES = `type DashboardScript = {
  dashboard: {
    set(patch: DashboardPatch): void;
    panel(id: string): PanelSelection;
    section(id: string): SectionSelection;
    panels(ids: string[]): PanelSelection;
    panelsMatching(filter: PanelFilter): PanelSelection;
    insertPanel(panel: PanelInput): InsertedPanel;
  };
};

type DashboardPatch = {
  name?: string;
  description?: string;
  columns?: number;
  filters?: unknown[];
  variables?: Record<string, string>;
};

type PanelPatch = {
  title?: string;
  sql?: string;
  source?: "bigquery" | "ga4" | "amplitude" | "first-party" | "demo" | "prometheus";
  chartType?: "line" | "area" | "bar" | "metric" | "table" | "pie" | "section" | "heatmap" | "callout";
  width?: number;
  columns?: number;
  tab?: string;
  config?: Record<string, unknown>;
  description?: string; // shorthand for config.description
};

type PanelFilter = {
  id?: string;
  ids?: string[];
  idIncludes?: string;
  title?: string;
  titleIncludes?: string;
  chartType?: PanelPatch["chartType"];
  source?: PanelPatch["source"];
  tab?: string;
  isSection?: boolean;
};

type PanelSelection = {
  moveToTop(): void;
  moveToBottom(): void;
  moveBefore(panelId: string): void;
  moveAfter(panelId: string): void;
  moveToIndex(index: number): void;
  remove(): void;
  set(patch: PanelPatch): void;
  setTitle(title: string): void;
  setSql(sql: string): void;
  setWidth(width: number): void;
  setConfig(patch: Record<string, unknown>): void;
  duplicate(newPanelId: string, patch?: PanelPatch): void;
};

type SectionSelection = PanelSelection & {
  append(panelIds: string[]): void;
};

type InsertedPanel = {
  atTop(): void;
  atBottom(): void;
  before(panelId: string): void;
  after(panelId: string): void;
  atIndex(index: number): void;
};`;

export const DASHBOARD_MUTATION_EXAMPLES = [
  'dashboard.panels(["dau-over-time","wau-over-time"]).moveToTop();',
  'dashboard.panel("top-referrers").setTitle("Top Referrers by Domain");',
  'dashboard.panel("retention").set({"width":2,"config":{"description":"Updated definition."}});',
  'dashboard.panelsMatching({"titleIncludes":"Signed-In"}).moveToTop();',
  'dashboard.section("retention-activity-section").append(["repeat-users","retention-over-time"]);',
  'dashboard.insertPanel({"id":"new-kpi","title":"New KPI","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(*) AS value FROM analytics_events"}).atTop();',
] as const;

export type DashboardMutationOperation =
  | {
      op: "movePanels";
      panelIds: string[];
      position?: "top" | "bottom";
      index?: number;
      beforePanelId?: string;
      afterPanelId?: string;
    }
  | {
      op: "removePanels";
      panelIds: string[];
    }
  | {
      op: "updatePanel";
      panelId: string;
      patch: Record<string, unknown>;
    }
  | {
      op: "insertPanel";
      panel: Record<string, unknown>;
      position?: "top" | "bottom";
      index?: number;
      beforePanelId?: string;
      afterPanelId?: string;
    }
  | {
      op: "duplicatePanel";
      panelId: string;
      newPanelId: string;
      patch?: Record<string, unknown>;
      position?: "top" | "bottom";
      index?: number;
      beforePanelId?: string;
      afterPanelId?: string;
    }
  | {
      op: "setDashboard";
      patch: Record<string, unknown>;
    };

export interface DashboardMutationResult {
  operations: DashboardMutationOperation[];
  commandLog: string[];
  changedPanelIds: string[];
  removedPanelIds: string[];
  insertedPanelIds: string[];
  dashboardFieldsChanged: string[];
}

type ParsedCall = {
  name: string;
  args: unknown[];
};

type MutationTarget = {
  position?: "top" | "bottom";
  index?: number;
  beforePanelId?: string;
  afterPanelId?: string;
};

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

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value.map((item, index) => assertString(item, `${label}[${index}]`));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function targetFromOperation(
  op: MutationTarget & { op: string },
): PanelOrderTarget {
  const targets = [
    op.index !== undefined,
    !!op.beforePanelId,
    !!op.afterPanelId,
  ].filter(Boolean).length;
  if (targets > 1) {
    throw new Error(
      `${op.op} accepts only one of index, beforePanelId, or afterPanelId`,
    );
  }
  if (op.beforePanelId) return { beforePanelId: op.beforePanelId };
  if (op.afterPanelId) return { afterPanelId: op.afterPanelId };
  if (op.index !== undefined) return { index: op.index };
  return { position: op.position ?? "bottom" };
}

function findPanelIndex(
  panels: Array<Record<string, unknown>>,
  id: string,
): number {
  return panels.findIndex((panel) => panelId(panel) === id);
}

function requirePanel(
  panels: Array<Record<string, unknown>>,
  id: string,
): Record<string, unknown> {
  const index = findPanelIndex(panels, id);
  if (index < 0) throw new Error(`panel "${id}" was not found`);
  return panels[index];
}

function insertPanel(
  config: Record<string, unknown>,
  panel: Record<string, unknown>,
  target: PanelOrderTarget,
): number {
  const panels = panelsFromConfig(config);
  const id = assertString(panel.id, "panel.id");
  if (findPanelIndex(panels, id) >= 0) {
    throw new Error(`panel "${id}" already exists`);
  }
  const placeholderId = `__agent_native_insert_${id}`;
  config.panels = [...panels, { ...panel, id: placeholderId }];
  const result = movePanelsById(config, [placeholderId], target);
  const nextPanels = panelsFromConfig(config);
  const inserted = requirePanel(nextPanels, placeholderId);
  inserted.id = id;
  return result.insertIndex;
}

function patchPanel(
  panel: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "description") {
      const config =
        panel.config &&
        typeof panel.config === "object" &&
        !Array.isArray(panel.config)
          ? { ...(panel.config as Record<string, unknown>) }
          : {};
      config.description = value;
      panel.config = config;
      changed.push("config.description");
      continue;
    }
    if (key === "config") {
      const config =
        panel.config &&
        typeof panel.config === "object" &&
        !Array.isArray(panel.config)
          ? { ...(panel.config as Record<string, unknown>) }
          : {};
      Object.assign(config, assertObject(value, "patch.config"));
      panel.config = config;
      changed.push("config");
      continue;
    }
    panel[key] = value;
    changed.push(key);
  }
  return changed;
}

function duplicatePanel(
  config: Record<string, unknown>,
  panelIdToCopy: string,
  newPanelId: string,
  patch: Record<string, unknown>,
  target: PanelOrderTarget,
): number {
  const panels = panelsFromConfig(config);
  const source = requirePanel(panels, panelIdToCopy);
  const duplicate = JSON.parse(JSON.stringify(source)) as Record<
    string,
    unknown
  >;
  duplicate.id = newPanelId;
  patchPanel(duplicate, patch);
  return insertPanel(config, duplicate, target);
}

export function applyDashboardMutationOperations(
  config: Record<string, unknown>,
  operations: DashboardMutationOperation[],
): DashboardMutationResult {
  if (operations.length === 0) {
    throw new Error("at least one dashboard mutation operation is required");
  }

  const commandLog: string[] = [];
  const changedPanelIds = new Set<string>();
  const removedPanelIds = new Set<string>();
  const insertedPanelIds = new Set<string>();
  const dashboardFieldsChanged = new Set<string>();

  for (const op of operations) {
    switch (op.op) {
      case "movePanels": {
        const result = movePanelsById(
          config,
          op.panelIds,
          targetFromOperation(op),
        );
        for (const id of result.movedPanelIds) changedPanelIds.add(id);
        commandLog.push(
          `movePanels(${result.movedPanelIds.join(", ")}) -> index ${result.insertIndex}`,
        );
        break;
      }
      case "removePanels": {
        const ids = uniqueStrings(op.panelIds);
        const panels = panelsFromConfig(config);
        for (const id of ids) requirePanel(panels, id);
        config.panels = panels.filter((panel) => !ids.includes(panelId(panel)));
        for (const id of ids) {
          changedPanelIds.add(id);
          removedPanelIds.add(id);
        }
        commandLog.push(`removePanels(${ids.join(", ")})`);
        break;
      }
      case "updatePanel": {
        const panel = requirePanel(panelsFromConfig(config), op.panelId);
        const changedFields = patchPanel(panel, op.patch);
        changedPanelIds.add(op.panelId);
        commandLog.push(
          `updatePanel(${op.panelId}: ${changedFields.join(", ") || "no fields"})`,
        );
        break;
      }
      case "insertPanel": {
        const index = insertPanel(config, op.panel, targetFromOperation(op));
        const id = assertString(op.panel.id, "panel.id");
        changedPanelIds.add(id);
        insertedPanelIds.add(id);
        commandLog.push(`insertPanel(${id}) -> index ${index}`);
        break;
      }
      case "duplicatePanel": {
        const index = duplicatePanel(
          config,
          op.panelId,
          op.newPanelId,
          op.patch ?? {},
          targetFromOperation(op),
        );
        changedPanelIds.add(op.newPanelId);
        insertedPanelIds.add(op.newPanelId);
        commandLog.push(
          `duplicatePanel(${op.panelId} -> ${op.newPanelId}) -> index ${index}`,
        );
        break;
      }
      case "setDashboard": {
        for (const [key, value] of Object.entries(op.patch)) {
          config[key] = value;
          dashboardFieldsChanged.add(key);
        }
        commandLog.push(
          `setDashboard(${Object.keys(op.patch).join(", ") || "no fields"})`,
        );
        break;
      }
      default:
        throw new Error(`unsupported dashboard mutation op ${(op as any).op}`);
    }
  }

  return {
    operations,
    commandLog,
    changedPanelIds: Array.from(changedPanelIds),
    removedPanelIds: Array.from(removedPanelIds),
    insertedPanelIds: Array.from(insertedPanelIds),
    dashboardFieldsChanged: Array.from(dashboardFieldsChanged),
  };
}

function stripLineComments(code: string): string {
  const lines = code.split(/\r?\n/);
  return lines
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];
        if (quote) {
          if (ch === "\\") {
            i++;
          } else if (ch === quote) {
            quote = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          continue;
        }
        if (ch === "/" && next === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

function hasTemplateLiteralSyntax(code: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "`") return true;
  }
  return false;
}

function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) throw new Error("unbalanced mutation script syntax");
      continue;
    }
    if (depth === 0 && ch === delimiter) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote) throw new Error("unterminated string in mutation script");
  if (depth !== 0) throw new Error("unbalanced mutation script syntax");
  const tail = input.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

function parseArg(raw: string): unknown {
  const value = raw.trim();
  if (!value) return undefined;
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'");
  }
  try {
    return JSON.parse(value);
  } catch (err: any) {
    throw new Error(
      `arguments must be JSON-compatible literals or quoted strings (got ${value}): ${err.message}`,
    );
  }
}

function parseArgs(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return splitTopLevel(trimmed, ",").map(parseArg);
}

function findMatchingParen(input: string, openIndex: number): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = openIndex; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced method call in mutation script");
}

function parseCallChain(statement: string): ParsedCall[] {
  let cursor = statement.trim();
  if (!cursor.startsWith("dashboard.")) {
    throw new Error(
      `mutation statements must start with dashboard.: ${statement}`,
    );
  }
  cursor = cursor.slice("dashboard.".length);
  const calls: ParsedCall[] = [];

  while (cursor.length > 0) {
    const method = cursor.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (!method) {
      throw new Error(`expected a dashboard API method call near: ${cursor}`);
    }
    const name = method[1];
    const openIndex = method[0].lastIndexOf("(");
    const closeIndex = findMatchingParen(cursor, openIndex);
    const rawArgs = cursor.slice(openIndex + 1, closeIndex);
    calls.push({ name, args: parseArgs(rawArgs) });
    cursor = cursor.slice(closeIndex + 1).trim();
    if (cursor.startsWith(".")) {
      cursor = cursor.slice(1).trim();
      continue;
    }
    if (cursor.length > 0) {
      throw new Error(`unexpected content after method call: ${cursor}`);
    }
  }

  return calls;
}

function panelIdsMatching(
  config: Record<string, unknown>,
  filter: Record<string, unknown>,
): string[] {
  const panels = panelsFromConfig(config);
  return panels
    .filter((panel) => {
      const id = panelId(panel);
      const title = typeof panel.title === "string" ? panel.title : "";
      if (filter.id !== undefined && id !== filter.id) return false;
      if (Array.isArray(filter.ids) && !filter.ids.includes(id)) return false;
      if (
        typeof filter.idIncludes === "string" &&
        !id.toLowerCase().includes(filter.idIncludes.toLowerCase())
      ) {
        return false;
      }
      if (filter.title !== undefined && title !== filter.title) return false;
      if (
        typeof filter.titleIncludes === "string" &&
        !title.toLowerCase().includes(filter.titleIncludes.toLowerCase())
      ) {
        return false;
      }
      if (
        filter.chartType !== undefined &&
        panel.chartType !== filter.chartType
      ) {
        return false;
      }
      if (filter.source !== undefined && panel.source !== filter.source) {
        return false;
      }
      if (filter.tab !== undefined && panel.tab !== filter.tab) return false;
      if (
        filter.isSection !== undefined &&
        (panel.chartType === "section") !== filter.isSection
      ) {
        return false;
      }
      return true;
    })
    .map(panelId)
    .filter(Boolean);
}

function targetFromChainCall(call: ParsedCall): MutationTarget {
  switch (call.name) {
    case "moveToTop":
    case "atTop":
      return { position: "top" };
    case "moveToBottom":
    case "atBottom":
      return { position: "bottom" };
    case "moveBefore":
    case "before":
      return {
        beforePanelId: assertString(call.args[0], `${call.name} panelId`),
      };
    case "moveAfter":
    case "after":
      return {
        afterPanelId: assertString(call.args[0], `${call.name} panelId`),
      };
    case "moveToIndex":
    case "atIndex":
      return { index: assertNumber(call.args[0], `${call.name} index`) };
    default:
      throw new Error(`unsupported placement method ${call.name}`);
  }
}

function operationFromPanelCommand(
  panelIds: string[],
  command: ParsedCall,
): DashboardMutationOperation {
  switch (command.name) {
    case "moveToTop":
    case "moveToBottom":
    case "moveBefore":
    case "moveAfter":
    case "moveToIndex":
      return {
        op: "movePanels",
        panelIds,
        ...targetFromChainCall(command),
      } as DashboardMutationOperation;
    case "remove":
      return { op: "removePanels", panelIds };
    case "set":
      return {
        op: "updatePanel",
        panelId: panelIds[0],
        patch: assertObject(command.args[0], "set patch"),
      };
    case "setTitle":
      return {
        op: "updatePanel",
        panelId: panelIds[0],
        patch: { title: assertString(command.args[0], "title") },
      };
    case "setSql":
      return {
        op: "updatePanel",
        panelId: panelIds[0],
        patch: { sql: assertString(command.args[0], "sql") },
      };
    case "setWidth":
      return {
        op: "updatePanel",
        panelId: panelIds[0],
        patch: { width: assertNumber(command.args[0], "width") },
      };
    case "setConfig":
      return {
        op: "updatePanel",
        panelId: panelIds[0],
        patch: { config: assertObject(command.args[0], "config patch") },
      };
    case "duplicate":
      return {
        op: "duplicatePanel",
        panelId: panelIds[0],
        newPanelId: assertString(command.args[0], "newPanelId"),
        patch:
          command.args[1] === undefined
            ? undefined
            : assertObject(command.args[1], "duplicate patch"),
      };
    default:
      throw new Error(`unsupported panel method ${command.name}`);
  }
}

function operationsFromStatement(
  config: Record<string, unknown>,
  statement: string,
): DashboardMutationOperation[] {
  const calls = parseCallChain(statement);
  if (calls.length === 0) return [];
  const [subject, ...commands] = calls;

  if (subject.name === "set") {
    if (commands.length > 0) {
      throw new Error("dashboard.set(...) cannot be chained");
    }
    return [
      {
        op: "setDashboard",
        patch: assertObject(subject.args[0], "dashboard patch"),
      },
    ];
  }

  if (commands.length === 0) {
    throw new Error(`mutation statement has no command: ${statement}`);
  }

  if (subject.name === "insertPanel") {
    if (commands.length > 1) {
      throw new Error(
        "dashboard.insertPanel(...) accepts one placement method",
      );
    }
    const [placement] = commands;
    return [
      {
        op: "insertPanel",
        panel: assertObject(subject.args[0], "panel"),
        ...(placement
          ? targetFromChainCall(placement)
          : { position: "bottom" }),
      } as DashboardMutationOperation,
    ];
  }

  if (subject.name === "section") {
    const sectionId = assertString(subject.args[0], "section id");
    const command = commands[0];
    if (command.name === "append") {
      if (commands.length > 1) {
        throw new Error("dashboard.section(...).append(...) cannot be chained");
      }
      return [
        {
          op: "movePanels",
          panelIds: assertStringArray(command.args[0], "append panelIds"),
          afterPanelId: sectionId,
        },
      ];
    }
    return [operationFromPanelCommand([sectionId], command)];
  }

  let panelIds: string[];
  if (subject.name === "panel") {
    panelIds = [assertString(subject.args[0], "panel id")];
  } else if (subject.name === "panels") {
    panelIds = assertStringArray(subject.args[0], "panel ids");
  } else if (subject.name === "panelsMatching") {
    panelIds = panelIdsMatching(
      config,
      assertObject(subject.args[0], "panel filter"),
    );
    if (panelIds.length === 0) {
      throw new Error("panelsMatching filter did not match any panels");
    }
  } else {
    throw new Error(`unsupported dashboard subject ${subject.name}`);
  }

  const ops = commands.map((command) => {
    const op = operationFromPanelCommand(panelIds, command);
    if (
      (op.op === "updatePanel" || op.op === "duplicatePanel") &&
      panelIds.length !== 1
    ) {
      throw new Error(`${command.name} requires exactly one selected panel`);
    }
    return op;
  });
  return ops;
}

export function parseDashboardMutationScript(
  config: Record<string, unknown>,
  code: string,
): DashboardMutationOperation[] {
  if (code.length > 12_000) {
    throw new Error("mutation script is too large; keep it under 12000 chars");
  }
  if (hasTemplateLiteralSyntax(code)) {
    throw new Error("mutation script does not support template literals");
  }
  const stripped = stripLineComments(code).trim();
  if (!stripped) {
    throw new Error("mutation script is empty");
  }
  const statements = splitTopLevel(stripped, ";");
  return statements.flatMap((statement) =>
    operationsFromStatement(config, statement),
  );
}
