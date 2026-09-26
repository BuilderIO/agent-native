import {
  IconArrowNarrowRight,
  IconChevronRight,
  IconDatabase,
  IconKey,
  IconLink,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { cn } from "../../utils.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type {
  DataModelChange,
  DataModelData,
  DataModelEntity,
  DataModelField,
  DataModelRelation,
  DataModelRelationKind,
} from "./data-model.config.js";
import { DATA_MODEL_CHANGES } from "./data-model.config.js";
import { DevInput, DevSelect } from "./dev-doc-ui.js";



const CHANGE_BADGE: Record<DataModelChange, string> = {
  added:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  modified: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  removed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  renamed:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

const CHANGE_LABEL: Record<DataModelChange, string> = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  renamed: "Renamed",
};

const CHANGE_NAME_INK: Record<DataModelChange, string> = {
  added: "text-emerald-700 dark:text-emerald-300",
  modified: "text-blue-700 dark:text-blue-300",
  removed: "text-red-600 line-through dark:text-red-300",
  renamed: "text-violet-700 dark:text-violet-300",
};

const CHANGE_ROW_ACCENT: Record<DataModelChange, string> = {
  added: "border-l-2 border-l-emerald-400 dark:border-l-emerald-500/60",
  modified: "border-l-2 border-l-blue-400 dark:border-l-blue-500/60",
  removed: "border-l-2 border-l-red-400 dark:border-l-red-500/60",
  renamed: "border-l-2 border-l-violet-400 dark:border-l-violet-500/60",
};

function ChangeChip({
  change,
  className,
}: {
  change: DataModelChange;
  className?: string;
}) {
  return (
    <span
      title={CHANGE_LABEL[change]}
      aria-label={CHANGE_LABEL[change]}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none",
        CHANGE_BADGE[change],
        className,
      )}
    >
      {CHANGE_LABEL[change]}
    </span>
  );
}


function parseFk(fk: string): { entity: string; field?: string } {
  const trimmed = fk.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) return { entity: trimmed };
  return {
    entity: trimmed.slice(0, dot).trim(),
    field: trimmed.slice(dot + 1).trim() || undefined,
  };
}

function resolveEntity(
  entities: DataModelEntity[],
  ref: string,
): DataModelEntity | undefined {
  const needle = ref.trim();
  return (
    entities.find((entity) => entity.id === needle) ??
    entities.find(
      (entity) => entity.name.toLowerCase() === needle.toLowerCase(),
    )
  );
}

function entityLabel(entities: DataModelEntity[], ref: string): string {
  return resolveEntity(entities, ref)?.name ?? ref;
}

function relationGlyph(kind?: DataModelRelationKind): string {
  if (kind === "1-1") return "1:1";
  if (kind === "n-n") return "n:n";
  return "1:n";
}

function effectiveRelations(data: DataModelData): DataModelRelation[] {
  if (data.relations && data.relations.length > 0) return data.relations;
  const inferred: DataModelRelation[] = [];
  for (const entity of data.entities) {
    for (const field of entity.fields) {
      if (!field.fk) continue;
      const target = resolveEntity(data.entities, parseFk(field.fk).entity);
      if (!target) continue;
      inferred.push({
        from: target.id,
        to: entity.id,
        kind: "1-n",
        label: field.name,
      });
    }
  }
  return inferred;
}


export function DataModelRead({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<DataModelData>) {
  const entities = data.entities ?? [];
  const relations = useMemo(() => effectiveRelations(data), [data]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    const expandAll = entities.length <= 2;
    entities.forEach((entity, index) => {
      initial[entity.id] = expandAll || index === 0;
    });
    return initial;
  });

  const [highlighted, setHighlighted] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggle = useCallback((id: string) => {
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const focusEntity = useCallback(
    (targetId: string | undefined, scroll: boolean) => {
      if (!targetId) {
        setHighlighted(null);
        return;
      }
      setHighlighted(targetId);
      if (scroll) {
        setExpanded((current) => ({ ...current, [targetId]: true }));
        cardRefs.current[targetId]?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    },
    [],
  );

  return (
    <section
      {...ltrCodeBlockProps}
      className="plan-block"
      data-block-id={blockId}
    >
      {title && <div className="plan-block-label">{title}</div>}

      <div className="flex flex-col gap-3">
        {entities.map((entity) => {
          const isOpen = expanded[entity.id] ?? false;
          const isHighlighted = highlighted === entity.id;
          return (
            <div
              key={entity.id}
              ref={(node) => {
                cardRefs.current[entity.id] = node;
              }}
              data-entity-id={entity.id}
              className={cn(
                "overflow-hidden rounded-xl border bg-plan-block transition-shadow",
                isHighlighted
                  ? "border-blue-400 ring-2 ring-blue-400/60 dark:border-blue-400 dark:ring-blue-400/50"
                  : "border-plan-line",
              )}
            >
              {/* Entity header — always visible, toggles the field table. */}
              <button
                type="button"
                data-plan-interactive
                aria-expanded={isOpen}
                onClick={() => toggle(entity.id)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
              >
                <IconChevronRight
                  className={cn(
                    "size-4 shrink-0 text-plan-muted transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
                <IconDatabase className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
                <span
                  className={cn(
                    "min-w-0 truncate font-mono text-sm font-semibold",
                    entity.change
                      ? CHANGE_NAME_INK[entity.change]
                      : "text-plan-text",
                  )}
                >
                  {entity.name}
                </span>
                {entity.change && <ChangeChip change={entity.change} />}
                <span className="ml-auto shrink-0 rounded-full bg-accent/50 px-2 py-0.5 text-[11px] font-medium text-plan-muted">
                  {entity.fields.length}{" "}
                  {entity.fields.length === 1 ? "field" : "fields"}
                </span>
              </button>

              {/* Expanded field table. */}
              {isOpen && (
                <div className="border-t border-plan-line">
                  {entity.note && (
                    <p className="px-4 pt-2 text-xs italic text-plan-muted">
                      {entity.note}
                    </p>
                  )}
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {entity.fields.map((field, index) => {
                        const fkTarget = field.fk
                          ? resolveEntity(entities, parseFk(field.fk).entity)
                          : undefined;
                        return (
                          <tr
                            key={`${field.name}-${index}`}
                            className={cn(
                              "border-t border-plan-line/70 align-top first:border-t-0",
                              field.fk && "cursor-pointer hover:bg-blue-500/5",
                              field.change && CHANGE_ROW_ACCENT[field.change],
                            )}
                            onMouseEnter={
                              fkTarget
                                ? () => focusEntity(fkTarget.id, false)
                                : undefined
                            }
                            onMouseLeave={
                              fkTarget
                                ? () => focusEntity(undefined, false)
                                : undefined
                            }
                            onClick={
                              fkTarget
                                ? () => focusEntity(fkTarget.id, true)
                                : undefined
                            }
                          >
                            <td className="w-px whitespace-nowrap py-1.5 pl-4 pr-2">
                              <div className="flex items-center gap-1.5">
                                {field.pk && (
                                  <IconKey
                                    className="size-3.5 shrink-0 text-amber-500 dark:text-amber-300"
                                    aria-label="Primary key"
                                  />
                                )}
                                {field.fk && (
                                  <IconLink
                                    className="size-3.5 shrink-0 text-blue-500 dark:text-blue-300"
                                    aria-label="Foreign key"
                                  />
                                )}
                                <span
                                  className={cn(
                                    "font-mono text-xs",
                                    field.pk && "font-semibold",
                                    field.change
                                      ? CHANGE_NAME_INK[field.change]
                                      : "text-plan-text",
                                  )}
                                >
                                  {field.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 pr-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {/* Prior value (`was`) for a modified field —
                                    struck through ahead of the current type. */}
                                {field.change === "modified" && field.was && (
                                  <>
                                    <span className="inline-block rounded bg-accent/30 px-1.5 py-0.5 font-mono text-[11px] text-plan-muted line-through">
                                      {field.was}
                                    </span>
                                    <IconArrowNarrowRight
                                      className="size-3 shrink-0 text-plan-muted"
                                      aria-hidden
                                    />
                                  </>
                                )}
                                {field.type && (
                                  <span
                                    className={cn(
                                      "inline-block rounded bg-accent/40 px-1.5 py-0.5 font-mono text-[11px]",
                                      field.change === "removed"
                                        ? "text-plan-muted line-through"
                                        : "text-plan-muted",
                                    )}
                                  >
                                    {field.type}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 pr-4 text-right">
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                {field.change && (
                                  <ChangeChip change={field.change} />
                                )}
                                {field.pk && (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15">
                                    PK
                                  </span>
                                )}
                                {field.fk && (
                                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-500/15">
                                    FK
                                    <span className="font-mono font-normal opacity-90">
                                      {fkTarget
                                        ? `${fkTarget.name}${
                                            parseFk(field.fk).field
                                              ? `.${parseFk(field.fk).field}`
                                              : ""
                                          }`
                                        : field.fk}
                                    </span>
                                  </span>
                                )}
                                {field.nullable && (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-plan-muted bg-accent/50">
                                    nullable
                                  </span>
                                )}
                                {field.default != null &&
                                  field.default !== "" && (
                                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] text-plan-muted bg-accent/40">
                                      = {field.default}
                                    </span>
                                  )}
                              </div>
                              {field.note && (
                                <div className="mt-0.5 text-[11px] italic text-plan-muted">
                                  {field.note}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {entity.fields.length === 0 && (
                        <tr>
                          <td className="px-4 py-2 text-xs text-plan-muted">
                            No fields yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Relations / connectors list. */}
      {relations.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
            Relations
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {relations.map((relation, index) => {
              const fromEntity = resolveEntity(entities, relation.from);
              const toEntity = resolveEntity(entities, relation.to);
              return (
                <button
                  key={`${relation.from}-${relation.to}-${index}`}
                  type="button"
                  data-plan-interactive
                  className="group flex w-fit items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent/40"
                  onMouseEnter={() => focusEntity(toEntity?.id, false)}
                  onMouseLeave={() => focusEntity(undefined, false)}
                  onClick={() => focusEntity(toEntity?.id, true)}
                >
                  <span className="font-mono text-xs font-semibold text-plan-text">
                    {entityLabel(entities, relation.from)}
                  </span>
                  <span className="flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                    {relationGlyph(relation.kind)}
                    <IconArrowNarrowRight className="size-3" />
                  </span>
                  <span className="font-mono text-xs font-semibold text-plan-text">
                    {entityLabel(entities, relation.to)}
                  </span>
                  {relation.label && (
                    <span className="text-xs text-plan-muted">
                      · {relation.label}
                    </span>
                  )}
                  {!fromEntity || !toEntity ? (
                    <span className="text-[10px] text-amber-600 dark:text-amber-300">
                      (unresolved)
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}


let entitySeq = 0;
function newEntityId(): string {
  entitySeq += 1;
  return `e_${Date.now().toString(36)}_${entitySeq}`;
}

export function DataModelEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<DataModelData>) {
  const entities = data.entities ?? [];

  const patchEntities = (next: DataModelEntity[]) =>
    onChange({ ...data, entities: next });

  const updateEntity = (index: number, next: Partial<DataModelEntity>) =>
    patchEntities(
      entities.map((entity, i) =>
        i === index ? { ...entity, ...next } : entity,
      ),
    );

  const removeEntity = (index: number) =>
    patchEntities(entities.filter((_, i) => i !== index));

  const addEntity = () =>
    patchEntities([
      ...entities,
      {
        id: newEntityId(),
        name: "NewEntity",
        fields: [{ name: "id", pk: true }],
      },
    ]);

  const updateField = (
    entityIndex: number,
    fieldIndex: number,
    next: Partial<DataModelField>,
  ) => {
    const entity = entities[entityIndex];
    if (!entity) return;
    updateEntity(entityIndex, {
      fields: entity.fields.map((field, i) =>
        i === fieldIndex ? { ...field, ...next } : field,
      ),
    });
  };

  const removeField = (entityIndex: number, fieldIndex: number) => {
    const entity = entities[entityIndex];
    if (!entity) return;
    updateEntity(entityIndex, {
      fields: entity.fields.filter((_, i) => i !== fieldIndex),
    });
  };

  const addField = (entityIndex: number) => {
    const entity = entities[entityIndex];
    if (!entity) return;
    updateEntity(entityIndex, {
      fields: [...entity.fields, { name: "field" }],
    });
  };

  return (
    <div className="flex flex-col gap-4" data-plan-interactive>
      {entities.map((entity, entityIndex) => (
        <div
          key={entity.id}
          className="flex flex-col gap-2 rounded-lg border border-input p-3"
        >
          <div className="flex items-center gap-2">
            <IconDatabase className="size-4 shrink-0 text-muted-foreground" />
            <DevInput
              className="h-8 font-mono text-sm font-semibold"
              value={entity.name}
              disabled={!editable}
              placeholder="EntityName"
              onChange={(event) =>
                updateEntity(entityIndex, { name: event.target.value })
              }
            />
            <DevSelect
              className="h-8 w-[120px] shrink-0"
              value={entity.change ?? "none"}
              disabled={!editable}
              onValueChange={(value) =>
                updateEntity(entityIndex, {
                  change:
                    value === "none" ? undefined : (value as DataModelChange),
                })
              }
              options={[
                { value: "none", label: "No change" },
                ...DATA_MODEL_CHANGES.map((change) => ({
                  value: change,
                  label: CHANGE_LABEL[change],
                })),
              ]}
            />
            {editable && (
              <button
                type="button"
                data-plan-interactive
                aria-label="Remove entity"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                onClick={() => removeEntity(entityIndex)}
              >
                <IconTrash className="size-4" />
              </button>
            )}
          </div>

          {/* Field rows. */}
          <div className="flex flex-col gap-1.5">
            {entity.fields.map((field, fieldIndex) => (
              <div
                key={fieldIndex}
                className="flex flex-col gap-1.5 rounded-md border border-input/60 bg-accent/20 p-2"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
                  <DevInput
                    className="h-7 font-mono text-xs"
                    value={field.name}
                    disabled={!editable}
                    placeholder="name"
                    onChange={(event) =>
                      updateField(entityIndex, fieldIndex, {
                        name: event.target.value,
                      })
                    }
                  />
                  <DevInput
                    className="h-7 font-mono text-xs"
                    value={field.type ?? ""}
                    disabled={!editable}
                    placeholder="type (e.g. uuid)"
                    onChange={(event) =>
                      updateField(entityIndex, fieldIndex, {
                        type: event.target.value || undefined,
                      })
                    }
                  />
                  {editable && (
                    <button
                      type="button"
                      data-plan-interactive
                      aria-label="Remove field"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      onClick={() => removeField(entityIndex, fieldIndex)}
                    >
                      <IconTrash className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-3.5 cursor-pointer accent-primary"
                      checked={Boolean(field.pk)}
                      disabled={!editable}
                      onChange={(event) =>
                        updateField(entityIndex, fieldIndex, {
                          pk: event.target.checked || undefined,
                        })
                      }
                    />
                    PK
                  </label>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-3.5 cursor-pointer accent-primary"
                      checked={Boolean(field.nullable)}
                      disabled={!editable}
                      onChange={(event) =>
                        updateField(entityIndex, fieldIndex, {
                          nullable: event.target.checked || undefined,
                        })
                      }
                    />
                    Nullable
                  </label>
                  <DevInput
                    className="h-7 flex-1 font-mono text-xs"
                    value={field.fk ?? ""}
                    disabled={!editable}
                    placeholder="FK → Entity.field"
                    onChange={(event) =>
                      updateField(entityIndex, fieldIndex, {
                        fk: event.target.value || undefined,
                      })
                    }
                  />
                </div>
                {/* Diff row: change kind + the prior value (`was`) when the
                    field is "modified", so before/after renders in Read. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <DevSelect
                    className="h-7 w-[120px] shrink-0"
                    value={field.change ?? "none"}
                    disabled={!editable}
                    onValueChange={(value) =>
                      updateField(entityIndex, fieldIndex, {
                        change:
                          value === "none"
                            ? undefined
                            : (value as DataModelChange),
                        ...(value === "modified" ? {} : { was: undefined }),
                      })
                    }
                    options={[
                      { value: "none", label: "No change" },
                      ...DATA_MODEL_CHANGES.map((change) => ({
                        value: change,
                        label: CHANGE_LABEL[change],
                      })),
                    ]}
                  />
                  {field.change === "modified" && (
                    <DevInput
                      className="h-7 flex-1 font-mono text-xs"
                      value={field.was ?? ""}
                      disabled={!editable}
                      placeholder="was (prior value, e.g. old type)"
                      onChange={(event) =>
                        updateField(entityIndex, fieldIndex, {
                          was: event.target.value || undefined,
                        })
                      }
                    />
                  )}
                </div>
              </div>
            ))}
            {editable && (
              <button
                type="button"
                data-plan-interactive
                className="flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                onClick={() => addField(entityIndex)}
              >
                <IconPlus className="size-3.5" />
                Add field
              </button>
            )}
          </div>
        </div>
      ))}

      {editable && (
        <button
          type="button"
          data-plan-interactive
          className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-2 text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          onClick={addEntity}
        >
          <IconPlus className="size-4" />
          Add entity
        </button>
      )}
    </div>
  );
}
