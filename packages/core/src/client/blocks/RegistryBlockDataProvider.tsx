import {
  RegistryBlockDataProvider as ToolkitRegistryBlockDataProvider,
  type RegistryBlockDataValue,
  type RegistryBlockRenderResult,
  type RegistryBlockSideMapBlock,
} from "@agent-native/toolkit/editor/RegistryBlockContext";
import { IconPencil } from "@tabler/icons-react";
import { useCallback, useMemo, type ReactNode } from "react";

import { blockEditSurface } from "./BlockView.js";
import { useOptionalBlockRegistry } from "./provider.js";
import { SchemaBlockEditor } from "./SchemaBlockEditor.js";

export function RegistryBlockDataProvider<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>({
  value,
  children,
}: {
  value: RegistryBlockDataValue<TBlock>;
  children: ReactNode;
}) {
  const registryValue = useOptionalBlockRegistry();
  const renderRegisteredBlock = useCallback(
    (
      block: TBlock,
      options: Parameters<
        NonNullable<RegistryBlockDataValue<TBlock>["renderRegisteredBlock"]>
      >[1],
    ): RegistryBlockRenderResult | null => {
      const spec = registryValue?.registry.get(options.blockType);
      if (!registryValue || !spec) return null;

      const blockType = options.blockType;
      const blockData = block.data;
      const Read = spec.Read;
      let body: ReactNode = (
        <Read
          data={blockData}
          blockId={block.id}
          title={block.title}
          summary={block.summary}
          ctx={registryValue.ctx}
        />
      );
      let editSurface: ReactNode = null;
      const canEditBlock = options.editable && spec.placement.includes("block");
      if (canEditBlock) {
        const Edit = spec.Edit;
        const editorNode = Edit ? (
          <Edit
            data={blockData}
            onChange={options.onChange}
            editable
            blockId={block.id}
            title={block.title}
            summary={block.summary}
            ctx={registryValue.ctx}
          />
        ) : (
          <SchemaBlockEditor
            data={blockData}
            onChange={(nextData) => options.onChange(nextData)}
            schema={spec.schema}
            editable
            blockId={block.id}
            ctx={registryValue.ctx}
          />
        );
        const surface = blockEditSurface(spec);
        if (surface === "panel" && registryValue.ctx.renderEditSurface) {
          editSurface = registryValue.ctx.renderEditSurface({
            title: spec.label,
            open: options.panelOpen,
            onOpenChange: options.setPanelOpen,
            blockId: block.id,
            blockType,
            blockTitle: block.title,
            blockSummary: block.summary,
            blockData,
            trigger: (
              <button
                type="button"
                data-plan-interactive
                aria-label={`Edit ${spec.label}`}
                onClick={() => options.setPanelOpen(true)}
                className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[visible=true]:opacity-100"
                data-visible={options.panelOpen || options.shellHovered}
              >
                <IconPencil className="size-4" />
              </button>
            ),
            children: editorNode,
          });
        } else if (surface === "panel") {
          editSurface = options.selected ? (
            <div className="mt-3">{editorNode}</div>
          ) : null;
        } else if (surface !== "none") {
          body = editorNode;
        }
      }
      return { body, editSurface };
    },
    [registryValue],
  );

  const resolvedValue = useMemo(
    () => ({
      ...value,
      renderRegisteredBlock,
      renderEditSurface: registryValue?.ctx.renderEditSurface,
    }),
    [registryValue?.ctx.renderEditSurface, renderRegisteredBlock, value],
  );
  return (
    <ToolkitRegistryBlockDataProvider value={resolvedValue}>
      {children}
    </ToolkitRegistryBlockDataProvider>
  );
}
