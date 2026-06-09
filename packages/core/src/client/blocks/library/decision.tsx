import { useState } from "react";
import {
  IconCheck,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import {
  decisionMdx,
  decisionSchema,
  type DecisionData,
  type DecisionOption,
} from "./decision.config.js";

/**
 * Standard `decision` block — a decision prompt with inline-editable option
 * cards and one authored "recommended" choice. Lives in core so any app can
 * register it (it originated in the plan template).
 *
 * The root `<section>` keeps the app-neutral `an-block` class (document-flow
 * spacing hook) alongside the legacy `plan-block` class (styled by the plan
 * template's own stylesheet), so plan renders as before and any other app gets
 * theme-token styling. All inner color comes from shadcn theme tokens
 * (`text-muted-foreground`, `text-foreground`, `bg-muted`, `bg-background`,
 * `border-border`, `ring`), so it reads correctly in any template palette.
 */
export function DecisionBlock({
  data,
  blockId,
  title,
}: BlockReadProps<DecisionData>) {
  return (
    <section className="an-block plan-block" data-block-id={blockId}>
      {title && <div className="an-block-label plan-block-label">{title}</div>}
      <p className="mt-3 max-w-3xl text-lg leading-8 text-muted-foreground">
        {data.question}
      </p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {data.options.map((option) => (
          <article
            key={option.id}
            className={cn(
              "rounded-xl border border-border bg-muted p-4",
              option.recommended
                ? "shadow-[inset_3px_0_0_hsl(var(--ring))]"
                : "opacity-85",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {option.label}
              </h3>
              {option.recommended && (
                <span className="rounded-full border border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Recommended
                </span>
              )}
            </div>
            {option.detail && (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {option.detail}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

const inlineInputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";
const inlineTextareaClass =
  "w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";
const inlineLabelClass =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

function newLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function DecisionBlockEdit({
  data,
  onChange,
  editable,
  blockId,
  title,
  summary,
  ctx,
}: BlockEditProps<DecisionData>) {
  const updateOption = (optionId: string, patch: Partial<DecisionOption>) =>
    onChange({
      ...data,
      options: data.options.map((option) =>
        option.id === optionId ? { ...option, ...patch } : option,
      ),
    });

  const removeOption = (optionId: string) => {
    if (data.options.length <= 1) return;
    onChange({
      ...data,
      options: data.options.filter((option) => option.id !== optionId),
    });
  };

  const addOption = () => {
    if (data.options.length >= 20) return;
    onChange({
      ...data,
      options: [
        ...data.options,
        { id: newLocalId("option"), label: "New option" },
      ],
    });
  };

  const settings = editable
    ? (ctx.renderEditSurface?.({
        title: "Decision",
        blockId,
        blockType: "decision",
        blockTitle: title,
        blockSummary: summary,
        blockData: data,
        trigger: (
          <button
            type="button"
            data-plan-interactive
            aria-label="Edit decision options"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <IconPencil className="size-4" />
          </button>
        ),
        children: (
          <DecisionSettings
            options={data.options}
            onToggleRecommended={(option) =>
              updateOption(option.id, { recommended: !option.recommended })
            }
            onRemove={removeOption}
            onAdd={addOption}
          />
        ),
      }) ?? (
        // No panel surface provided by the host: fall back to a plain inline
        // settings card so option management still works.
        <DecisionInlineSettings
          options={data.options}
          onToggleRecommended={(option) =>
            updateOption(option.id, { recommended: !option.recommended })
          }
          onRemove={removeOption}
          onAdd={addOption}
        />
      ))
    : null;

  return (
    <div className="grid gap-5" data-plan-interactive>
      <div className="flex items-start gap-3">
        <label className="grid min-w-0 flex-1 gap-1.5">
          <span className={inlineLabelClass}>Question</span>
          <textarea
            className={inlineTextareaClass}
            rows={2}
            value={data.question}
            disabled={!editable}
            onChange={(event) =>
              onChange({ ...data, question: event.target.value })
            }
          />
        </label>
        {settings}
      </div>
      <div className="grid gap-3">
        {data.options.map((option) => (
          <article
            key={option.id}
            className={cn(
              "rounded-lg border border-border bg-muted p-4",
              option.recommended &&
                "border-ring/60 shadow-[inset_3px_0_0_hsl(var(--ring))]",
            )}
          >
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className={inlineLabelClass}>Option</span>
                <input
                  className={inlineInputClass}
                  value={option.label}
                  disabled={!editable}
                  onChange={(event) =>
                    updateOption(option.id, { label: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="mt-3 grid gap-1.5">
              <span className={inlineLabelClass}>Detail</span>
              <textarea
                className={inlineTextareaClass}
                rows={2}
                value={option.detail ?? ""}
                disabled={!editable}
                onChange={(event) =>
                  updateOption(option.id, {
                    detail: event.target.value || undefined,
                  })
                }
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
}

/** Option-management controls rendered inside the host's edit surface popover. */
function DecisionSettings({
  options,
  onToggleRecommended,
  onRemove,
  onAdd,
}: {
  options: DecisionOption[];
  onToggleRecommended: (option: DecisionOption) => void;
  onRemove: (optionId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="text-sm font-semibold text-foreground">
        Decision settings
      </div>
      <div className="grid gap-2">
        {options.map((option, index) => (
          <div
            key={option.id}
            className="grid gap-2 rounded-md border border-border bg-muted/20 p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-medium text-foreground">
                {option.label.trim() || `Option ${index + 1}`}
              </span>
              {option.recommended && (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Recommended
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-plan-interactive
                onClick={() => onToggleRecommended(option)}
                className={cn(
                  "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors",
                  option.recommended
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
              >
                {option.recommended && <IconCheck className="size-3.5" />}
                {option.recommended ? "Recommended" : "Mark recommended"}
              </button>
              <button
                type="button"
                data-plan-interactive
                aria-label={`Delete ${option.label || `option ${index + 1}`}`}
                disabled={options.length <= 1}
                onClick={() => onRemove(option.id)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconTrash className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-plan-interactive
        disabled={options.length >= 20}
        onClick={onAdd}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconPlus className="size-3.5" />
        Add option
      </button>
    </div>
  );
}

/**
 * Fallback for hosts that do not provide `ctx.renderEditSurface`: a plain
 * disclosure button that reveals the same settings inline (no overlay primitive,
 * so core stays shadcn-free).
 */
function DecisionInlineSettings(props: {
  options: DecisionOption[];
  onToggleRecommended: (option: DecisionOption) => void;
  onRemove: (optionId: string) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        data-plan-interactive
        aria-label="Edit decision options"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <IconPencil className="size-4" />
      </button>
      {open && (
        <div className="w-80 rounded-md border border-border bg-background p-3 shadow-sm">
          <DecisionSettings {...props} />
        </div>
      )}
    </div>
  );
}

/** Full client spec for the shared `decision` block (schema + MDX + Read/Edit). */
export const decisionBlock = defineBlock<DecisionData>({
  type: "decision",
  schema: decisionSchema,
  mdx: decisionMdx,
  Read: DecisionBlock,
  Edit: DecisionBlockEdit,
  placement: ["block"],
  editSurface: "inline",
  label: "Decision",
  description:
    "A decision prompt with inline-editable option cards and an authored recommended choice.",
  empty: () => ({
    question: "Which implementation direction should we take?",
    options: [
      {
        id: "recommended",
        label: "Recommended path",
        detail: "Smallest useful slice with clear rollback.",
        recommended: true,
      },
      {
        id: "alternative",
        label: "Alternative",
        detail: "Broader pass that touches more surfaces.",
      },
    ],
  }),
});
