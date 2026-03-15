import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["J"], description: "Next period (day / week / month)" },
      { keys: ["K"], description: "Previous period" },
      { keys: ["T"], description: "Go to today" },
      { keys: ["N"], description: "Next week" },
      { keys: ["P"], description: "Previous week" },
    ],
  },
  {
    category: "Views",
    shortcuts: [
      { keys: ["M"], description: "Month view" },
      { keys: ["W"], description: "Week view" },
      { keys: ["D"], description: "Day view" },
    ],
  },
  {
    category: "Events",
    shortcuts: [
      { keys: ["C"], description: "Create new event" },
      { keys: ["E"], description: "Edit selected event" },
      { keys: ["Del"], description: "Delete selected event" },
      { keys: ["Esc"], description: "Close dialog / cancel" },
    ],
  },
  {
    category: "Search & Quick Actions",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["/"], description: "Open command palette" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
];

export function KeyboardShortcutsHelp({
  open,
  onClose,
}: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dark sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          {SHORTCUT_GROUPS.map(({ category, shortcuts }) => (
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
          Shortcuts are disabled while typing in text fields.
        </p>
      </DialogContent>
    </Dialog>
  );
}
