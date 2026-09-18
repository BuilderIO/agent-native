import type { BlockAiFieldActionProps, BlockRenderContext } from "./types.js";

export function AiEditableFieldLabel({
  htmlFor,
  label,
  ctx,
  action,
}: {
  htmlFor: string;
  label: string;
  ctx: BlockRenderContext;
  action?: Omit<BlockAiFieldActionProps, "fieldLabel">;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-background/95 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold text-muted-foreground"
      >
        {label}
      </label>
      {action
        ? ctx.renderAiFieldAction?.({
            ...action,
            fieldLabel: label,
          })
        : null}
    </div>
  );
}
