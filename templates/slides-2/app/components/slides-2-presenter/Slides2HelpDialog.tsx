import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Slides2PresenterLabels } from "./Slides2Player";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: Slides2PresenterLabels;
  hasPresenter: boolean;
  container: HTMLElement | null;
};

export default function Slides2HelpDialog({
  open,
  onOpenChange,
  labels,
  hasPresenter,
  container,
}: Props) {
  const shortcuts = [
    { keys: ["→", "↓", "Space", "PgDn"], label: labels.shortcutNext },
    { keys: ["←", "↑", "PgUp"], label: labels.shortcutPrevious },
    { keys: ["Home", "End"], label: labels.shortcutFirstLast },
    { keys: ["1–9", "Enter"], label: labels.shortcutJump },
    { keys: ["O"], label: labels.shortcutOverview },
    { keys: ["B"], label: labels.shortcutBlackout },
    { keys: ["W"], label: labels.shortcutWhiteout },
    { keys: ["L"], label: labels.shortcutLaser },
    ...(hasPresenter ? [{ keys: ["P"], label: labels.shortcutPresenter }] : []),
    { keys: ["?", "H"], label: labels.shortcutHelp },
    { keys: ["Esc"], label: labels.shortcutExit },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container ?? undefined}
        closeLabel={labels.close}
        className="max-w-lg sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{labels.helpTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {shortcuts.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
            >
              <span className="text-sm text-foreground/85">{row.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {row.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
