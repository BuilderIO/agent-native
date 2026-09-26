import { IconPencil } from "@tabler/icons-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { SchemaBlockEditor } from "./SchemaBlockEditor.js";
import type {
  BlockDataChangeMeta,
  BlockSpec,
  BlockRenderContext,
} from "./types.js";

export function blockEditSurface(
  spec: BlockSpec<any>,
): "inline" | "panel" | "container" | "none" {
  return spec.editSurface ?? (spec.Edit ? "inline" : "panel");
}

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
  editing: boolean;
  editable?: boolean;
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

  return formNode;
}
