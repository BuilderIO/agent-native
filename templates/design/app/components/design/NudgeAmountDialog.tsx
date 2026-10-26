import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";

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

  const field = (key: keyof NudgeAmounts) => {
    const descriptionId = `nudge-amount-${key}-description`;
    return (
      <div className="flex items-center justify-between gap-3 text-sm text-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <label htmlFor={`nudge-amount-${key}`} className="cursor-default">
              {t(`designEditor.keyboardShortcuts.nudgeAmount.${key}`)}
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-64">
            {t(`designEditor.keyboardShortcuts.nudgeAmount.${key}Description`)}
          </TooltipContent>
        </Tooltip>
        <span id={descriptionId} className="sr-only">
          {t(`designEditor.keyboardShortcuts.nudgeAmount.${key}Description`)}
        </span>
        <span className="flex items-center gap-2">
          <Input
            id={`nudge-amount-${key}`}
            aria-describedby={descriptionId}
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
      </div>
    );
  };

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
          <DialogTitle className="text-sm font-semibold leading-none">
            {t("designEditor.keyboardShortcuts.nudgeAmount.title")}
          </DialogTitle>
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
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-col gap-3 px-4 py-4">
            {field("small")}
            {field("big")}
          </div>
        </TooltipProvider>
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
