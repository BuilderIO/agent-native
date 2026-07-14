import { useT } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconLayoutColumns,
  IconLayoutRows,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { AutoLayoutSuggestion } from "../../pages/design-editor/auto-layout-suggestion";

export interface AutoLayoutSuggestionDialogProps {
  open: boolean;
  suggestion: AutoLayoutSuggestion | null;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}

export function AutoLayoutSuggestionDialog({
  open,
  suggestion,
  onOpenChange,
  onApply,
}: AutoLayoutSuggestionDialogProps) {
  const t = useT();
  const DirectionIcon =
    suggestion?.direction === "row" ? IconLayoutRows : IconLayoutColumns;
  const warningLabels = suggestion?.warnings.map((warning) =>
    t(`designEditor.autoLayoutSuggestion.warnings.${warning}`),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("designEditor.autoLayoutSuggestion.title")}
          </DialogTitle>
          <DialogDescription>
            {t("designEditor.autoLayoutSuggestion.description")}
          </DialogDescription>
        </DialogHeader>

        {suggestion ? (
          <div className="space-y-4">
            <div
              aria-label={t("designEditor.autoLayoutSuggestion.preview")}
              className="grid min-h-32 place-items-center overflow-hidden rounded-lg border bg-muted/30 p-5"
            >
              <div
                className="flex max-w-full rounded border-2 border-dashed border-[var(--design-editor-selection-color)] bg-background p-3"
                style={{
                  flexDirection: suggestion.direction,
                  gap: Math.min(24, Math.max(4, suggestion.gap / 2)),
                  alignItems: suggestion.alignItems,
                  justifyContent: suggestion.justifyContent,
                }}
              >
                {suggestion.orderedChildIds.map((id, index) => (
                  <div
                    key={id}
                    className="grid min-h-7 min-w-10 place-items-center rounded bg-[var(--design-editor-selection-color)]/20 px-2 text-[10px] font-medium text-foreground"
                  >
                    {index + 1}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <PreviewValue
                label={t("editPanel.labels.direction")}
                value={t(`editPanel.flexDirections.${suggestion.direction}`)}
                icon={<DirectionIcon className="size-4" />}
              />
              <PreviewValue
                label={t("editPanel.labels.gap")}
                value={`${suggestion.gap}px`}
              />
              <PreviewValue
                label={t("editPanel.labels.padding")}
                value={`${suggestion.padding.top} / ${suggestion.padding.right} / ${suggestion.padding.bottom} / ${suggestion.padding.left}`}
              />
              <PreviewValue
                label={t("designEditor.autoLayoutSuggestion.sizing")}
                value={`${t(`designEditor.autoLayoutSuggestion.${suggestion.horizontalSizing}`)} × ${t(`designEditor.autoLayoutSuggestion.${suggestion.verticalSizing}`)}`}
              />
              <PreviewValue
                label={t("editPanel.labels.align")}
                value={suggestion.alignItems}
              />
              <PreviewValue
                label={t("editPanel.labels.order")}
                value={suggestion.orderedChildIds
                  .map((_, index) => index + 1)
                  .join(" → ")}
              />
            </div>

            {warningLabels && warningLabels.length > 0 ? (
              <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{warningLabels.join(" ")}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("designEditor.autoLayoutSuggestion.cancel")}
          </Button>
          <Button disabled={!suggestion?.safeToApply} onClick={onApply}>
            {t("designEditor.autoLayoutSuggestion.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewValue({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-1.5 font-medium">
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}
