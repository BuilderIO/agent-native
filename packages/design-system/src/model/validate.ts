import { MODEL_PARTS, type ModelPart, modelPartRefs } from "./parts.js";
import type { ModelRow, RowEffect, ScreenModel } from "./types.js";

const ROW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const REGION = /^[a-z]+(?:-[a-z]+)*$/;

export type ModelIssue =
  | { code: "invalid-id"; rowId: string }
  | { code: "duplicate-id"; rowId: string }
  | { code: "unknown-part"; rowId: string; part: string }
  | { code: "empty-label"; rowId: string }
  | { code: "open-target-missing"; rowId: string; target: string }
  | { code: "section-without-rows"; rowId: string }
  | { code: "duplicate-anchor"; rowId: string; anchor: string }
  | { code: "invalid-region"; rowId: string; region: string }
  | { code: "hosts-without-slot"; rowId: string };

export interface FlatRow {
  row: ModelRow;
  depth: number;
  parentId: string | undefined;
}

/** Every row in document order, with its depth and parent. */
export function flattenModel(model: ScreenModel): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (
    list: readonly ModelRow[],
    depth: number,
    parentId: string | undefined,
  ) => {
    for (const row of list) {
      rows.push({ row, depth, parentId });
      if (row.rows) visit(row.rows, depth + 1, row.id);
    }
  };
  visit(model.rows, 0, undefined);
  return rows;
}

/**
 * Every structural problem in a model. An empty list means both part sets can
 * draw it and the equivalence check can join their rows.
 */
export function validateModel(
  model: ScreenModel,
  parts: readonly ModelPart[] = MODEL_PARTS,
): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const known = modelPartRefs(parts);
  const flat = flattenModel(model);
  const ids = new Set<string>();
  const anchors = new Set<string>();
  for (const { row } of flat) {
    if (row.anchor !== undefined) {
      if (anchors.has(row.anchor)) {
        issues.push({
          code: "duplicate-anchor",
          rowId: row.id,
          anchor: row.anchor,
        });
      }
      anchors.add(row.anchor);
    }
    if (!ROW_ID.test(row.id))
      issues.push({ code: "invalid-id", rowId: row.id });
    if (ids.has(row.id)) issues.push({ code: "duplicate-id", rowId: row.id });
    ids.add(row.id);
    if (!known.has(row.part)) {
      issues.push({ code: "unknown-part", rowId: row.id, part: row.part });
    }
    if (row.label.trim() === "") {
      issues.push({ code: "empty-label", rowId: row.id });
    }
    for (const [region, slot] of Object.entries(row.regions ?? {})) {
      if (!REGION.test(region) || slot.trim() === "") {
        issues.push({ code: "invalid-region", rowId: row.id, region });
      }
    }
    const holdsContent =
      row.slot !== undefined || Object.keys(row.regions ?? {}).length > 0;
    if (row.hosts !== undefined && row.hosts.length > 0 && !holdsContent) {
      issues.push({ code: "hosts-without-slot", rowId: row.id });
    }
    if (row.kind === "section" && (row.rows?.length ?? 0) === 0) {
      issues.push({ code: "section-without-rows", rowId: row.id });
    }
  }
  for (const { row } of flat) {
    const target = openTarget(row.effect);
    if (target !== undefined && !ids.has(target)) {
      issues.push({ code: "open-target-missing", rowId: row.id, target });
    }
  }
  return issues;
}

function openTarget(effect: RowEffect | undefined): string | undefined {
  return effect?.kind === "open" ? effect.target : undefined;
}

export class InvalidModelError extends Error {
  constructor(
    readonly modelId: string,
    readonly issues: readonly ModelIssue[],
  ) {
    super(
      `Screen model ${modelId} is invalid: ${issues
        .map((issue) => `${issue.code} (${issue.rowId})`)
        .join(", ")}`,
    );
    this.name = "InvalidModelError";
  }
}

/** The model itself, or an InvalidModelError listing every issue. */
export function assertValidModel<Model extends ScreenModel>(
  model: Model,
  parts: readonly ModelPart[] = MODEL_PARTS,
): Model {
  const issues = validateModel(model, parts);
  if (issues.length > 0) throw new InvalidModelError(model.id, issues);
  return model;
}
