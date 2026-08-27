import { IconCheck, IconPhotoScan, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export interface ReferenceSelectionComposerBubbleProps {
  /** Short label for the currently selected element, e.g. "Pricing card". */
  label: string;
  /** True once the selection is tagged as a reference for the next message. */
  active: boolean;
  onArm: () => void;
  onClear: () => void;
}

/**
 * Mirrors FigmaLinkComposerBubble's shape (a small bubble surfaced above the
 * composer, driven by live composer text plus explicit selection state) so
 * "reference the selection" reads as the same kind of ambient assist as
 * "import this Figma link" rather than a one-off control.
 */
export function ReferenceSelectionComposerBubble({
  label,
  active,
  onArm,
  onClear,
}: ReferenceSelectionComposerBubbleProps) {
  return (
    <div className="mx-3 mb-1.5 flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-2.5 py-2 shadow-sm">
      <IconPhotoScan className="size-4 shrink-0 text-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">
          {active
            ? "Referencing selected element" /* i18n-ignore reference composer bubble */
            : "Selected element" /* i18n-ignore reference composer bubble */}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      </div>
      {active ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
          onClick={onClear}
        >
          <IconCheck className="size-3 text-emerald-500" />
          {"Tagged" /* i18n-ignore reference composer bubble */}
          <IconX className="size-3" />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={onArm}
        >
          {"Use as reference" /* i18n-ignore reference composer bubble */}
        </Button>
      )}
    </div>
  );
}
