import { IconPencil } from "@tabler/icons-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { SchemaBlockEditor } from "./SchemaBlockEditor.js";
import type {
  BlockDataChangeMeta,
  BlockSpec,
  BlockRenderContext,
} from "./types.js";

/**
 * Resolve a spec's effective edit surface. Defaults to `"inline"` when the block
 * ships a custom `Edit` (its author built direct-manipulation editing), else
 * `"panel"` — an auto-form block is a property form, which reads best behind a
 * corner edit button. An explicit `spec.editSurface` always wins.
 */
export function blockEditSurface(
  spec: BlockSpec<any>,
): "inline" | "panel" | "container" | "none" {
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
  compactVisuals,
}: {
  spec: BlockSpec<any>;
  block: { id: string; title?: string; summary?: string; data: unknown };
  /** Whether the document is in an editable/edit state. */
  editing: boolean;
  /** Whether this specific block allows editing (block.editable !== false). */
  editable?: boolean;
  /** Commit a new `data` value for the block. */
  onChange?: (nextData: unknown, meta?: BlockDataChangeMeta) => void;
  ctx: BlockRenderContext;
  compactVisuals?: boolean;
}) {
  const [panelHovered, setPanelHovered] = useState(false);
  const Read = spec.Read;
  const readNode = (
    <Read
      data={block.data}
      blockId={block.id}
      title={block.title}
      summary={block.summary}
      ctx={ctx}
      compactVisuals={compactVisuals}
    />
  );

  const canEdit =
    editing && editable && spec.placement.includes("block") && !!onChange;

  if (!canEdit) return readNode;

  if (blockEditSurface(spec) === "none") return readNode;

  const commit = (nextData: unknown, meta?: BlockDataChangeMeta) =>
    onChange?.(nextData, meta);
  const updatePanelHover = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    setPanelHovered(
      target instanceof HTMLElement &&
        target.closest(".an-block-panel") === event.currentTarget,
    );
  };

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
      <div
        className="an-block-panel relative"
        onMouseEnter={updatePanelHover}
        onMouseMove={updatePanelHover}
        onMouseLeave={() => setPanelHovered(false)}
      >
        {readNode}
        <div className="an-block-panel__edit absolute right-2 top-2 z-10">
          {ctx.renderEditSurface({
            title: spec.label,
            blockId: block.id,
            blockType: spec.type,
            blockTitle: block.title,
            blockSummary: block.summary,
            blockData: block.data,
            trigger: (
              <button
                type="button"
                data-plan-interactive
                aria-label={`Edit ${spec.label}`}
                className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[visible=true]:opacity-100"
                data-visible={panelHovered}
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
