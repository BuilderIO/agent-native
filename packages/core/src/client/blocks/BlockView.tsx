import type { BlockSpec, BlockRenderContext } from "./types.js";
import { SchemaBlockEditor } from "./SchemaBlockEditor.js";

/**
 * Render one registered block. In read mode (or when the spec is inline-only and
 * not editing) it renders the spec's `Read`. In edit mode for a `block`-placed
 * spec it renders the spec's `Edit` if present, otherwise the schema-driven
 * {@link SchemaBlockEditor}. This is what the app renderer delegates to once the
 * registry recognizes a block type — the legacy switch handles unregistered
 * types.
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
  const canEdit =
    editing && editable && spec.placement.includes("block") && !!onChange;

  if (!canEdit) {
    const Read = spec.Read;
    return (
      <Read
        data={block.data}
        blockId={block.id}
        title={block.title}
        summary={block.summary}
        ctx={ctx}
      />
    );
  }

  const commit = (nextData: unknown) => onChange?.(nextData);

  if (spec.Edit) {
    const Edit = spec.Edit;
    return (
      <Edit
        data={block.data}
        onChange={commit}
        editable
        blockId={block.id}
        title={block.title}
        summary={block.summary}
        ctx={ctx}
      />
    );
  }

  return (
    <SchemaBlockEditor
      data={block.data}
      onChange={commit}
      schema={spec.schema}
      editable
      blockId={block.id}
      ctx={ctx}
    />
  );
}
