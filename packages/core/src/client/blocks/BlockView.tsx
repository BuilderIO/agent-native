import { IconPencil } from "@tabler/icons-react";
import type { BlockSpec, BlockRenderContext } from "./types.js";
import { SchemaBlockEditor } from "./SchemaBlockEditor.js";

/**
 * Resolve a spec's effective edit surface. Defaults to `"inline"` when the block
 * ships a custom `Edit` (its author built direct-manipulation editing), else
 * `"panel"` — an auto-form block is a property form, which reads best behind a
 * corner edit button. An explicit `spec.editSurface` always wins.
 */
export function blockEditSurface(spec: BlockSpec<any>): "inline" | "panel" {
  return spec.editSurface ?? (spec.Edit ? "inline" : "panel");
}

/**
 * Render one registered block. In read mode (or when the spec is inline-only and
 * not editing) it renders the spec's `Read`. In edit mode for a `block`-placed
 * spec it renders the editor — either inline (the spec's `Edit` or the
 * schema-driven {@link SchemaBlockEditor}) or, for `editSurface: "panel"` blocks,
 * the rendered `Read` plus a corner edit button that opens that editor in the
 * app-provided panel ({@link BlockRenderContext.renderEditSurface}, e.g. a
 * popover). This is what the app renderer delegates to once the registry
 * recognizes a block type — the legacy switch handles unregistered types.
 */
export function BlockView({
  spec,
  block,
  editing,
  editable = true,
  onChange,
  ctx,
}: {
  spec: BlockSpec<any>;
  block: { id: string; title?: string; summary?: string; data: unknown };
  /** Whether the document is in an editable/edit state. */
  editing: boolean;
  /** Whether this specific block allows editing (block.editable !== false). */
  editable?: boolean;
  /** Commit a new `data` value for the block. */
  onChange?: (nextData: unknown) => void;
  ctx: BlockRenderContext;
}) {
  const Read = spec.Read;
  const readNode = (
    <Read
      data={block.data}
      blockId={block.id}
      title={block.title}
      summary={block.summary}
      ctx={ctx}
    />
  );

  const canEdit =
    editing && editable && spec.placement.includes("block") && !!onChange;

  if (!canEdit) return readNode;

  const commit = (nextData: unknown) => onChange?.(nextData);

  const Edit = spec.Edit;
  const formNode = Edit ? (
    <Edit
      data={block.data}
      onChange={commit}
      editable
      blockId={block.id}
      title={block.title}
      summary={block.summary}
      ctx={ctx}
    />
  ) : (
    <SchemaBlockEditor
      data={block.data}
      onChange={commit}
      schema={spec.schema}
      editable
      blockId={block.id}
      ctx={ctx}
    />
  );

  // Panel mode: show the rendered block with a corner edit button that opens the
  // form in the app-provided panel (popover). Falls back to inline editing when
  // the app hasn't wired `renderEditSurface`.
  if (blockEditSurface(spec) === "panel" && ctx.renderEditSurface) {
    return (
      <div className="an-block-panel group relative">
        {readNode}
        <div className="an-block-panel__edit absolute right-2 top-2 z-10">
          {ctx.renderEditSurface({
            title: spec.label,
            trigger: (
              <button
                type="button"
                data-plan-interactive
                aria-label={`Edit ${spec.label}`}
                className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <IconPencil className="size-4" />
              </button>
            ),
            children: formNode,
          })}
        </div>
      </div>
    );
  }

  // Inline mode (direct manipulation).
  return formNode;
}
