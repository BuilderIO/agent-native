import { useT } from "@agent-native/core/client/i18n";
import { IconInfoCircle, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MAX_NUDGE_AMOUNT,
  MIN_NUDGE_AMOUNT,
  normalizeNudgeAmount,
} from "@/pages/design-editor/editor-preferences";
import {
  DEFAULT_NUDGE_AMOUNTS,
  type NudgeAmounts,
} from "@/pages/design-editor/nudge-intent";

interface NudgeAmountDialogProps {
  open: boolean;
  onClose: () => void;
  nudgeAmounts?: NudgeAmounts;
  onNudgeAmountsChange: (next: NudgeAmounts) => void;
}

export function NudgeAmountDialog({
  open,
  onClose,
  nudgeAmounts = DEFAULT_NUDGE_AMOUNTS,
  onNudgeAmountsChange,
}: NudgeAmountDialogProps) {
  const t = useT();

  const field = (key: keyof NudgeAmounts, labelKey: string) => (
    <label className="flex items-center justify-between gap-3 text-sm text-foreground">
      <span>{t(labelKey)}</span>
      <span className="flex items-center gap-2">
        <Input
          data-nudge-amount={key}
          type="number"
          size="sm"
          min={MIN_NUDGE_AMOUNT}
          max={MAX_NUDGE_AMOUNT}
          value={nudgeAmounts[key]}
          onChange={(event) =>
            onNudgeAmountsChange({
              ...nudgeAmounts,
              [key]: normalizeNudgeAmount(
                event.target.value,
                nudgeAmounts[key],
              ),
            })
          }
          className="w-20 text-end text-sm md:text-sm"
        />
        <span className="w-4 text-muted-foreground">
          {t("designEditor.keyboardShortcuts.nudgeAmount.unit")}
        </span>
      </span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        // Shares the shortcuts dialog's marker so editor hotkeys (arrows,
        // digits, tool letters) stay inert while typing in the number fields.
        data-keyboard-shortcuts-dialog=""
        data-nudge-amount-dialog
        hideClose
        aria-describedby={undefined}
        className="flex w-[calc(100vw-24px)] max-w-[376px] flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const small = (
            event.currentTarget as HTMLElement
          ).querySelector<HTMLInputElement>('[data-nudge-amount="small"]');
          small?.focus();
          small?.select();
        }}
        // The editor restores focus itself (handleCloseNudgeAmount).
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between ps-4 pe-2 pt-3">
          <div className="flex items-center gap-1.5">
            <DialogTitle className="text-sm font-semibold leading-none">
              {t("designEditor.keyboardShortcuts.nudgeAmount.title")}
            </DialogTitle>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(
                      "designEditor.keyboardShortcuts.nudgeAmount.title",
                    )}
                    className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <IconInfoCircle className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="max-w-64 whitespace-pre-line"
                >
                  {t("designEditor.keyboardShortcuts.nudgeAmount.description")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("designEditor.keyboardShortcuts.nudgeAmount.close")}
            >
              <IconX className="size-4" />
            </Button>
          </DialogClose>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          {field("small", "designEditor.keyboardShortcuts.nudgeAmount.small")}
          {field("big", "designEditor.keyboardShortcuts.nudgeAmount.big")}
        </div>
        <div className="flex justify-end border-t border-border p-3">
          <DialogClose asChild>
            <Button type="button" size="sm">
              {t("designEditor.keyboardShortcuts.nudgeAmount.done")}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
