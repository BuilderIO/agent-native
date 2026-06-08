import { IconCheck, IconPlus, IconX } from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type { BlockReadProps, BlockEditProps } from "../types.js";
import {
  checklistSchema,
  checklistMdx,
  type ChecklistData,
  type ChecklistItem,
} from "./checklist.config.js";

/**
 * Standard `checklist` block. A list of toggleable items, each with a label and
 * an optional note. Lives in core so any app can register it.
 *
 * `Read` mirrors the legacy plan `PlanBlockView` checklist branch byte-for-byte
 * (same `plan-block` section, toggle buttons, `IconCheck` marker, and the
 * existing toggle-via-`onChange` behavior) so converting the block to the
 * registry does not change rendered output. The plan CSS classes
 * (`plan-block`, `text-plan-*`, `border-plan-line`) resolve against the plan
 * app's stylesheet at render time, exactly as before.
 *
 * `Edit` is a custom editor (the schema auto-editor can't edit an array of
 * objects): it lets you add, remove, toggle, and relabel items inline.
 */

/** Mint a reasonably-unique item id without pulling a dep into core. */
function newItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read renderer. Note `onToggle` is supplied by the block dispatcher for the
 * historical click-to-toggle behavior; in pure read contexts it is omitted and
 * the markers render statically.
 */
export function ChecklistBlock({
  data,
  blockId,
  title,
  onToggle,
}: BlockReadProps<ChecklistData> & {
  onToggle?: (itemId: string) => void;
}) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <div className="grid gap-3">
        {data.items.map((item) =>
          onToggle ? (
            <button
              key={item.id}
              type="button"
              data-plan-interactive
              className="flex items-start gap-3 text-left text-plan-muted"
              onClick={() => onToggle(item.id)}
            >
              <ChecklistMarker checked={item.checked} />
              <ChecklistItemBody item={item} />
            </button>
          ) : (
            <div
              key={item.id}
              className="flex items-start gap-3 text-left text-plan-muted"
            >
              <ChecklistMarker checked={item.checked} />
              <ChecklistItemBody item={item} />
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function ChecklistMarker({ checked }: { checked?: boolean }) {
  return (
    <span
      className={cn(
        "mt-1 flex size-5 items-center justify-center rounded border",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-plan-line",
      )}
    >
      {checked && <IconCheck className="size-3.5" />}
    </span>
  );
}

function ChecklistItemBody({ item }: { item: ChecklistItem }) {
  return (
    <span>
      <span className="block text-plan-text">{item.label}</span>
      {item.note && <span className="block text-sm">{item.note}</span>}
    </span>
  );
}

/** Custom editor: toggle, relabel, add, and remove items. */
export function ChecklistEditor({
  data,
  onChange,
  editable,
}: BlockEditProps<ChecklistData>) {
  const items = data.items;

  const update = (next: ChecklistItem[]) => onChange({ items: next });

  const toggle = (id: string) =>
    update(
      items.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    );

  const setLabel = (id: string, label: string) =>
    update(items.map((item) => (item.id === id ? { ...item, label } : item)));

  const remove = (id: string) => update(items.filter((item) => item.id !== id));

  const add = () =>
    update([...items, { id: newItemId(), label: "", checked: false }]);

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="group flex items-start gap-2">
          <button
            type="button"
            data-plan-interactive
            aria-label={item.checked ? "Mark incomplete" : "Mark complete"}
            className={cn(
              "mt-1 flex size-5 shrink-0 items-center justify-center rounded border",
              item.checked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-plan-line",
            )}
            onClick={() => toggle(item.id)}
          >
            {item.checked && <IconCheck className="size-3.5" />}
          </button>
          <input
            type="text"
            data-plan-interactive
            className="flex h-9 w-full rounded-md bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Checklist item"
            value={item.label}
            disabled={!editable}
            onChange={(event) => setLabel(item.id, event.target.value)}
          />
          <button
            type="button"
            data-plan-interactive
            aria-label="Remove item"
            className="mt-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-50"
            disabled={!editable}
            onClick={() => remove(item.id)}
          >
            <IconX className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        data-plan-interactive
        className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        disabled={!editable}
        onClick={add}
      >
        <IconPlus className="size-4" />
        Add item
      </button>
    </div>
  );
}

/**
 * The standard checklist block spec (with React `Read`/`Edit`). Apps register
 * this in their browser registry. The schema + MDX config come from
 * `./checklist.config.ts`, the exact same object server / agent code registers,
 * so rendering and source round-trip never drift.
 *
 * `Read` is typed against `BlockReadProps<ChecklistData>`; the optional
 * `onToggle` the dispatcher injects for the legacy click-to-toggle behavior is
 * an extra prop the registry's `BlockView` passes through harmlessly when
 * present (it lives outside `BlockReadProps`, so it's wired by the app's block
 * dispatch rather than the generic `BlockView`).
 */
export const checklistBlock = defineBlock<ChecklistData>({
  type: "checklist",
  schema: checklistSchema,
  mdx: checklistMdx,
  Read: ChecklistBlock as never,
  Edit: ChecklistEditor,
  placement: ["block"],
  editSurface: "inline",
  // A checklist maps to NFM to-do items, so it round-trips to Notion.
  notionCompatible: true,
  label: "Checklist",
  icon: IconCheck,
  description:
    "A list of toggleable items, each with a label and an optional note.",
  empty: () => ({ items: [] }),
});
