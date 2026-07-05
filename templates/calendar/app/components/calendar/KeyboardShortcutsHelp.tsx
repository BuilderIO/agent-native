import { useT } from "@agent-native/core/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";

import { shortcutModifierLabel } from "@/lib/utils";

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsHelp({
  open,
  onClose,
}: KeyboardShortcutsHelpProps) {
  const t = useT();
  const shortcutGroups = [
    {
      category: t("keyboardShortcuts.navigation"),
      shortcuts: [
        { keys: ["J"], description: t("keyboardShortcuts.nextPeriod") },
        { keys: ["K"], description: t("keyboardShortcuts.previousPeriod") },
        { keys: ["T"], description: t("keyboardShortcuts.goToday") },
        {
          keys: ["P"],
          description: t("keyboardShortcuts.showTeammateCalendars"),
        },
      ],
    },
    {
      category: t("keyboardShortcuts.views"),
      shortcuts: [
        { keys: ["M"], description: t("keyboardShortcuts.monthView") },
        { keys: ["W"], description: t("keyboardShortcuts.weekView") },
        { keys: ["D"], description: t("keyboardShortcuts.dayView") },
      ],
    },
    {
      category: t("keyboardShortcuts.events"),
      shortcuts: [
        { keys: ["C"], description: t("keyboardShortcuts.createNewEvent") },
        {
          keys: ["Del"],
          description: t("keyboardShortcuts.deleteSelectedEvent"),
        },
        { keys: ["Esc"], description: t("keyboardShortcuts.closeDialog") },
      ],
    },
    {
      category: t("keyboardShortcuts.searchQuickActions"),
      shortcuts: [
        {
          keys: [shortcutModifierLabel(), "K"],
          description: t("keyboardShortcuts.openCommandPalette"),
        },
        { keys: ["/"], description: t("keyboardShortcuts.openCommandPalette") },
        {
          keys: ["?"],
          description: t("keyboardShortcuts.showKeyboardShortcuts"),
        },
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("keyboardShortcuts.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          {shortcutGroups.map(({ category, shortcuts }) => (
            <div key={category}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </h3>
              <div className="space-y-0.5">
                {shortcuts.map(({ keys, description }) => (
                  <div
                    key={description}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent/50 transition-colors"
                  >
                    <span className="text-sm text-foreground">
                      {description}
                    </span>
                    <div className="flex items-center gap-1">
                      {keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground border-t border-border pt-3 mt-1">
          {t("keyboardShortcuts.disabledWhileTyping")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
