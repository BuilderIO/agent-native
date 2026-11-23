import { isDeepStrictEqual } from "node:util";

import type { CellContents } from "../../../app/lib/model/contracts.js";
import type { AppDocument } from "../../../shared/app-layout.js";
import type {
  NotebookHistoryEffect,
  NotebookHistoryGroup,
  NotebookHistoryItem,
} from "../../../shared/notebook-history.js";
import type { NotebookEvent } from "../../../shared/notebook-operations.js";

type EditItem = Extract<NotebookHistoryItem, { kind: "edits" }>;
type Group = Omit<NotebookHistoryGroup, "effects">;
type Effect = Omit<NotebookHistoryEffect, "count">;
type GroupChange = { group: Group; effect: Effect };

const burstDuration = 10 * 60 * 1000;
const internalCellFields = new Set([
  "id",
  "connectionSelectedAt",
  "pendingEdit",
]);
const displayedFields = new Set(["label", "name", "resultVariable", "title"]);
const visibleDefaultTypes = new Set([
  "DATE",
  "DROPDOWN",
  "CHECKBOX",
  "NUMERIC_INPUT",
  "SLIDER",
  "MULTISELECT",
]);

function label(value: unknown) {
  return typeof value === "string" && value.trim() !== ""
    ? value.slice(0, 160)
    : null;
}

function fieldsChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !isDeepStrictEqual(before[key], after[key]),
  );
}

function cellGroup(contents: CellContents): Group {
  const symbol =
    "name" in contents
      ? contents.name
      : "resultVariable" in contents
        ? contents.resultVariable
        : "title" in contents
          ? contents.title
          : null;
  return {
    kind: "cell",
    id: contents.id,
    label: label(contents.label) ?? label(symbol),
    cellKind: contents.kind,
  };
}

function appChanges(
  before: AppDocument | undefined,
  after: AppDocument,
): Effect[] {
  if (!before) return [{ type: "edit", field: "layout", value: null }];
  const effects = fieldsChanged(before.settings, after.settings).map(
    (key): Effect => ({
      type: "edit",
      field: key,
      value: null,
    }),
  );
  if (
    before.initialized !== after.initialized ||
    !isDeepStrictEqual(before.tabs, after.tabs)
  )
    effects.push({ type: "edit", field: "layout", value: null });
  return effects;
}

function eventChanges(event: NotebookEvent): GroupChange[] {
  const { before, receipt } = event;
  const project: Group = {
    kind: "project",
    id: "project",
    label: null,
    cellKind: null,
  };
  const app: Group = { kind: "app", id: "app", label: null, cellKind: null };
  if (receipt.versionChange?.type === "checkpoint") return [];
  if (
    receipt.versionChange?.type === "restore" ||
    receipt.previousHead.versionId !== receipt.nextHead.versionId
  )
    return [
      {
        group: project,
        effect: { type: "restore", field: "version", value: null },
      },
    ];

  const changes: GroupChange[] = [];
  const prior = new Map(before.cells.map(({ id, contents }) => [id, contents]));
  const restored = new Set<string>(
    before.tombstones.map(({ cellId }) => cellId),
  );
  const { delta } = receipt;
  for (const { cellId } of delta.tombstones) {
    const contents = prior.get(cellId);
    if (contents)
      changes.push({
        group: cellGroup(contents),
        effect: { type: "delete", field: "cell", value: null },
      });
  }
  for (const { id, contents } of delta.cells) {
    const group = cellGroup(contents);
    const old = prior.get(id);
    if (!old) {
      const type = restored.has(id) ? "restore" : "insert";
      changes.push({ group, effect: { type, field: "cell", value: null } });
      continue;
    }
    if (old.kind !== contents.kind) {
      changes.push({
        group,
        effect: { type: "edit", field: "kind", value: null },
      });
      continue;
    }
    const after: Record<string, unknown> = contents;
    for (const key of fieldsChanged(old, after)) {
      if (!internalCellFields.has(key)) {
        const visibleDefault =
          key === "defaultValueString" &&
          contents.kind === "input" &&
          visibleDefaultTypes.has(contents.inputType);
        changes.push({
          group,
          effect: {
            type: key === "order" ? "move" : "edit",
            field: key,
            value:
              displayedFields.has(key) || visibleDefault
                ? label(after[key])
                : null,
          },
        });
      }
    }
  }
  if (before.metadata && delta.metadata) {
    const after: Record<string, unknown> = delta.metadata;
    for (const key of fieldsChanged(before.metadata, after))
      changes.push({
        group: project,
        effect: {
          type: "edit",
          field: key,
          value: displayedFields.has(key) ? label(after[key]) : null,
        },
      });
  }
  if (delta.appLayout)
    changes.push(
      ...appChanges(before.appLayout, delta.appLayout).map((effect) => ({
        group: app,
        effect,
      })),
    );
  return changes;
}

export function groupNotebookHistory(
  events: NotebookEvent[],
  truncated: boolean,
): EditItem[] {
  const buckets: EditItem[] = [];
  const active = new Map<string, EditItem>();
  const olderThan = events[0]?.receipt.committedAt;
  for (const event of events) {
    const changes = eventChanges(event);
    if (changes.length === 0) continue;
    const actor = event.principalId;
    const at = event.receipt.committedAt;
    const clock = Date.parse(at);
    let bucket = active.get(actor);
    if (!bucket || clock - Date.parse(bucket.startedAt) >= burstDuration) {
      bucket = {
        kind: "edits",
        id: `edits:${event.sequence}`,
        actor,
        startedAt: at,
        endedAt: at,
        changeCount: 0,
        lowerBound:
          !bucket &&
          truncated &&
          olderThan !== undefined &&
          clock - Date.parse(olderThan) < burstDuration,
        groups: [],
      };
      active.set(actor, bucket);
      buckets.push(bucket);
    }
    bucket.endedAt = at;
    for (const { group, effect } of changes) {
      let subgroup = bucket.groups.find(
        ({ kind, id }) => kind === group.kind && id === group.id,
      );
      if (!subgroup) {
        subgroup = { ...group, effects: [] };
        bucket.groups.push(subgroup);
      }
      subgroup.label = group.label;
      subgroup.cellKind = group.cellKind;
      const repeated = subgroup.effects.find(
        ({ type, field }) => type === effect.type && field === effect.field,
      );
      if (repeated) {
        repeated.count++;
        repeated.value = effect.value;
      } else {
        subgroup.effects.push({ ...effect, count: 1 });
        bucket.changeCount++;
      }
    }
  }
  return buckets;
}
