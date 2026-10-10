import { createHash } from "node:crypto";

import type {
  DashboardSyncBase,
  DashboardSyncStatus,
} from "../../../shared/dashboard-github-sync";
import { stableStringify } from "../../../shared/panel-render-contract";

const PANEL = "panel:";

/** Stands in for a hash a never-synced base does not have. No real hash is empty, so comparisons read it as absent. */
const NEVER_SYNCED = "";

export function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(`blob ${body.length}\0`)
    .update(body)
    .digest("hex");
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface DashboardDocument {
  id: string;
  kind: "sql" | "explorer";
  /** Includes the title (`title` or `name`) and `panels`. */
  config: Record<string, unknown>;
}

export function dashboardFileContent(doc: DashboardDocument): string {
  // Always write `panels`: a file without it is rejected on parse, so a typo'd key can never read as "no panels".
  const config = {
    ...doc.config,
    panels: doc.config.panels === undefined ? [] : doc.config.panels,
  };
  const stable = JSON.parse(
    stableStringify({ id: doc.id, kind: doc.kind, config }),
  );
  return `${JSON.stringify(stable, null, 2)}\n`;
}

export function parseDashboardFile(content: string): DashboardDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Dashboard file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed))
    throw new Error("Dashboard file must be a JSON object");
  const { id, kind, config } = parsed;
  if (typeof id !== "string" || id === "") {
    throw new Error("Dashboard file id must be a non-empty string");
  }
  if (kind !== "sql" && kind !== "explorer") {
    throw new Error('Dashboard file kind must be "sql" or "explorer"');
  }
  if (!isRecord(config))
    throw new Error("Dashboard file config must be an object");
  if (!Array.isArray(config.panels)) {
    throw new Error("Dashboard file config.panels must be an array");
  }
  // Throws on malformed panels. The panels themselves are read again by unitHashes.
  readPanels(config);
  return { id, kind, config };
}

export interface UnitHashes {
  panels: Record<string, string>;
  order: string;
  meta: string;
}

export function unitHashes(doc: DashboardDocument): UnitHashes {
  const panels = readPanels(doc.config);
  return {
    panels: Object.fromEntries(
      panels.map((panel): [string, string] => [panel.id, hashJson(panel)]),
    ),
    order: hashJson(panels.map((panel) => panel.id)),
    meta: hashJson(withoutPanels(doc.config)),
  };
}

export function dashboardBase(
  doc: DashboardDocument,
  filePath: string,
  fileSha: string,
): DashboardSyncBase {
  return { filePath, fileSha, ...unitHashes(doc) };
}

/** `panel:<id>`, `order`, or `meta`. */
export type SyncUnit = string;

export interface PullPlan {
  changes: SyncUnit[];
  conflicts: SyncUnit[];
  panelOps: Array<
    | { op: "upsert"; id: string; panel: Record<string, unknown> }
    | { op: "delete"; id: string }
  >;
  order: string[] | null;
  meta: {
    kind: DashboardDocument["kind"];
    config: Record<string, unknown>;
  } | null;
  /**
   * Null only for a never-synced dashboard that still has conflicts. No base is
   * recorded then, so the next run re-derives the same plan and converges.
   */
  nextBase: DashboardSyncBase | null;
}

export function planPull(input: {
  base: DashboardSyncBase | null;
  filePath: string;
  repoSha: string;
  repo: DashboardDocument;
  db: DashboardDocument | null;
}): PullPlan {
  const repoHashes = unitHashes(input.repo);
  const repo = unitMap(repoHashes);
  const db = input.db
    ? unitMap(unitHashes(input.db))
    : new Map<SyncUnit, string>();
  const base = input.base ? unitMap(input.base) : new Map<SyncUnit, string>();
  const repoPanels = readPanels(input.repo.config);
  const repoPanelById = new Map(
    repoPanels.map((panel) => [panel.id, panel] as const),
  );

  const changes: SyncUnit[] = [];
  const conflicts: SyncUnit[] = [];
  // Take or converged: the base advances to the repo hash for these units.
  const adopted = new Set<SyncUnit>();
  for (const unit of unitsOf(repo, base)) {
    const repoHash = repo.get(unit);
    // A create must write every unit the repo has, even when the file still matches base.
    const decision =
      input.db === null && repoHash !== undefined
        ? "take"
        : decide(repoHash, db.get(unit), base.get(unit));
    if (decision === "take") changes.push(unit);
    if (decision === "conflict") conflicts.push(unit);
    if (decision === "take" || decision === "converged") adopted.add(unit);
  }

  const panelOps: PullPlan["panelOps"] = changes
    .filter((unit) => unit.startsWith(PANEL))
    .map((unit): PullPlan["panelOps"][number] => {
      const id = unit.slice(PANEL.length);
      const panel = repoPanelById.get(id);
      return panel ? { op: "upsert", id, panel } : { op: "delete", id };
    });

  const nextPanels = new Map<string, string>(
    Object.entries(input.base?.panels ?? {}),
  );
  for (const unit of adopted) {
    if (!unit.startsWith(PANEL)) continue;
    const id = unit.slice(PANEL.length);
    const hash = repo.get(unit);
    if (hash === undefined) nextPanels.delete(id);
    else nextPanels.set(id, hash);
  }

  return {
    changes,
    conflicts,
    panelOps,
    order: changes.includes("order")
      ? repoPanels.map((panel) => panel.id)
      : null,
    meta: changes.includes("meta")
      ? { kind: input.repo.kind, config: withoutPanels(input.repo.config) }
      : null,
    nextBase:
      input.base === null && conflicts.length > 0
        ? null
        : {
            filePath: input.filePath,
            fileSha:
              conflicts.length === 0
                ? input.repoSha
                : (input.base?.fileSha ?? NEVER_SYNCED),
            panels: Object.fromEntries(nextPanels),
            order: adopted.has("order")
              ? repoHashes.order
              : (input.base?.order ?? NEVER_SYNCED),
            meta: adopted.has("meta")
              ? repoHashes.meta
              : (input.base?.meta ?? NEVER_SYNCED),
          },
  };
}

export function applyPullPlan(
  db: DashboardDocument | null,
  repo: DashboardDocument,
  plan: PullPlan,
): DashboardDocument {
  const start: DashboardDocument = db ?? {
    id: repo.id,
    kind: repo.kind,
    config: {},
  };
  const panels = new Map<string, Record<string, unknown>>();
  for (const panel of readPanels(start.config)) panels.set(panel.id, panel);
  for (const op of plan.panelOps) {
    if (op.op === "delete") panels.delete(op.id);
    else panels.set(op.id, op.panel);
  }

  let entries = [...panels];
  if (plan.order) {
    const order = plan.order;
    const rank = new Map(order.map((id, index) => [id, index] as const));
    // Ids missing from the order keep their relative position after the ordered ones.
    const rankOf = (id: string) => rank.get(id) ?? order.length;
    entries = entries.sort(([a], [b]) => rankOf(a) - rankOf(b));
  }
  const panelList = entries.map(([, panel]) => panel);

  return {
    id: start.id,
    kind: start.kind,
    config: plan.meta
      ? { ...plan.meta.config, panels: panelList }
      : { ...start.config, panels: panelList },
  };
}

export type PushPlan =
  | { status: "in-sync" }
  | { status: "blocked"; reason: string }
  | {
      status: "export";
      changes: SyncUnit[];
      content: string;
      blobSha: string;
      base: DashboardSyncBase;
    };

export function planPush(input: {
  base: DashboardSyncBase | null;
  filePath: string;
  repoSha: string | null;
  db: DashboardDocument;
}): PushPlan {
  if (input.base === null && input.repoSha !== null) {
    return {
      status: "blocked",
      reason: "exists in GitHub but is not synced; pull first",
    };
  }
  if (input.base !== null && input.repoSha === null) {
    return { status: "blocked", reason: "deleted in GitHub" };
  }
  if (input.base !== null && input.repoSha !== input.base.fileSha) {
    return { status: "blocked", reason: "changed in GitHub; pull first" };
  }
  const changes = changedUnits(input.db, input.base);
  if (changes.length === 0) return { status: "in-sync" };

  const content = dashboardFileContent(input.db);
  const blobSha = gitBlobSha(content);
  return {
    status: "export",
    changes,
    content,
    blobSha,
    base: dashboardBase(input.db, input.filePath, blobSha),
  };
}

export interface DashboardSyncClassification {
  status: DashboardSyncStatus;
  pullChanges: SyncUnit[];
  conflicts: SyncUnit[];
  /** App-side changes since base, whether or not export is currently allowed. */
  exportChanges: SyncUnit[];
}

export function classifyDashboardSync(input: {
  base: DashboardSyncBase | null;
  filePath: string;
  repoSha: string | null;
  repo: DashboardDocument | null;
  db: DashboardDocument | null;
}): DashboardSyncClassification {
  const { base, filePath, repoSha, repo, db } = input;
  if (repoSha === null) {
    if (db === null) {
      throw new Error(
        "Dashboard has neither a row nor a GitHub file; there is nothing to classify",
      );
    }
    return {
      status: base ? "removed-in-github" : "not-exported",
      pullChanges: [],
      conflicts: [],
      exportChanges: changedUnits(db, base),
    };
  }

  // A file that matches base cannot differ from it, so the repo document is only read when it changed.
  const unchanged = db !== null && base !== null && repoSha === base.fileSha;
  let pullChanges: SyncUnit[] = [];
  let conflicts: SyncUnit[] = [];
  if (!unchanged) {
    if (repo === null) {
      throw new Error(
        "classifyDashboardSync needs the parsed repo document for this GitHub file",
      );
    }
    const pull = planPull({ base, filePath, repoSha, repo, db });
    pullChanges = pull.changes;
    conflicts = pull.conflicts;
  }

  if (db === null) {
    return {
      status: "new-in-github",
      pullChanges,
      conflicts,
      exportChanges: [],
    };
  }
  const exportChanges = changedUnits(db, base);
  return {
    status: syncStatus(pullChanges, conflicts, exportChanges),
    pullChanges,
    conflicts,
    exportChanges,
  };
}

type UnitMap = Map<SyncUnit, string>;

type PanelRecord = Record<string, unknown> & { id: string };

type Decision = "none" | "take" | "app-only" | "converged" | "conflict";

/** The per-unit rules. Order matters: `db === base` alone already implies the repo changed. */
function decide(
  repo: string | undefined,
  db: string | undefined,
  base: string | undefined,
): Decision {
  if (repo === base && db === base) return "none";
  if (db === base) return "take";
  if (repo === base) return "app-only";
  if (repo === db) return "converged";
  return "conflict";
}

function unitMap(hashes: UnitHashes): UnitMap {
  const units: UnitMap = new Map();
  for (const [id, hash] of Object.entries(hashes.panels)) {
    units.set(`${PANEL}${id}`, hash);
  }
  units.set("order", hashes.order);
  units.set("meta", hashes.meta);
  return units;
}

/** Panel units in first-seen order, then `order` and `meta`. */
function unitsOf(...sides: UnitMap[]): SyncUnit[] {
  const seen = new Set<SyncUnit>();
  for (const side of sides) for (const unit of side.keys()) seen.add(unit);
  return [...seen]
    .filter((unit) => unit.startsWith(PANEL))
    .concat(["order", "meta"]);
}

/** Units the dashboard differs from base in, deletions included. A null base makes every unit differ. */
function changedUnits(
  db: DashboardDocument,
  base: DashboardSyncBase | null,
): SyncUnit[] {
  const dbUnits = unitMap(unitHashes(db));
  const baseUnits: UnitMap = base ? unitMap(base) : new Map();
  return unitsOf(dbUnits, baseUnits).filter(
    (unit) => dbUnits.get(unit) !== baseUnits.get(unit),
  );
}

function syncStatus(
  pullChanges: SyncUnit[],
  conflicts: SyncUnit[],
  exportChanges: SyncUnit[],
): DashboardSyncStatus {
  if (conflicts.length > 0) return "conflict";
  if (pullChanges.length > 0 && exportChanges.length > 0) return "both-changed";
  if (pullChanges.length > 0) return "github-changed";
  if (exportChanges.length > 0) return "app-changed";
  return "in-sync";
}

function readPanels(config: Record<string, unknown>): PanelRecord[] {
  if (config.panels === undefined) return [];
  const panels: unknown = config.panels;
  if (!Array.isArray(panels)) {
    throw new Error("Dashboard config.panels must be an array");
  }
  const ids = new Set<string>();
  return panels.map((panel: unknown, index: number): PanelRecord => {
    if (!isPanel(panel)) {
      throw new Error(
        `Dashboard panel at index ${index} must be an object with a non-empty string id`,
      );
    }
    if (ids.has(panel.id)) {
      throw new Error(
        `Dashboard panel id "${panel.id}" appears more than once`,
      );
    }
    ids.add(panel.id);
    return panel;
  });
}

function isPanel(value: unknown): value is PanelRecord {
  return isRecord(value) && typeof value.id === "string" && value.id !== "";
}

function withoutPanels(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => key !== "panels"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
