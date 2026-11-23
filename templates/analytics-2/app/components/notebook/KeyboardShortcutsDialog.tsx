import { useT } from "@agent-native/core/client/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ADDABLE_CELL_KINDS } from "@/lib/model/cell-types";

import { insertCommands, notebookCommands } from "./notebook-commands";
import { cellRunShortcutLabel } from "./NotebookRunControls";

const ShortcutContext = createContext<(() => void) | null>(null);
export function useOpenKeyboardShortcuts() {
  const open = useContext(ShortcutContext);
  return () => {
    if (!open) throw new Error("KeyboardShortcutsProvider is missing");
    open();
  };
}

export function KeyboardShortcutsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const previousFocus = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openDialog = useCallback(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    setOpen(true);
  }, []);
  const closeDialog = useCallback(() => {
    setOpen(false);
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.defaultPrevented ||
        !event.shiftKey ||
        !(event.code === "Slash" || event.key === "?")
      )
        return;
      if (!(event.metaKey || event.ctrlKey)) {
        const target =
          event.target instanceof Element
            ? event.target
            : document.activeElement;
        if (
          event.key !== "?" ||
          !(
            target?.closest(".nb-root") ||
            (target === document.body && document.querySelector(".nb-root"))
          ) ||
          target.closest('input, textarea, select, [contenteditable="true"]')
        )
          return;
      }
      if (
        !open &&
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]):not([data-closed]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([data-closed]):not([hidden])',
        )
      )
        return;
      event.preventDefault();
      if (open) closeDialog();
      else openDialog();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, openDialog, closeDialog]);
  const t = useT();
  const mod =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘"
      : "Ctrl";
  const definitions: { label: string; items: [string, string][] }[] = [
    {
      label: t("keyboardShortcuts.global"),
      items: [
        [t("keyboardShortcuts.help"), `${mod} + Shift + /`],
        [t("commandPalette.newProject"), "Alt + Shift + N"],
        [t("commandPalette.importProject"), "Alt + Shift + U"],
        [t("commandPalette.newComponent"), "Alt + Shift + C"],
        [t("commandPalette.newCollection"), "Alt + Shift + L"],
        [t("commandPalette.open"), `${mod} + P`],
        [t("commandPalette.sidebar"), "Alt + Shift + `"],
        [t("commandPalette.cellAgent"), `${mod} + Shift + M`],
        [t("keyboardShortcuts.search"), `${mod} + K`],
      ],
    },
    {
      label: t("keyboardShortcuts.editor"),
      items: [
        [t("keyboardShortcuts.runCell"), `${mod} + Enter`],
        [t("keyboardShortcuts.runCellAndAdvance"), "Shift + Enter"],
        [
          t("keyboardShortcuts.runCellAndInsert"),
          `${mod === "⌘" ? "Option" : "Alt"} + Enter`,
        ],
        [t("notebook.runModeAutoLabel"), cellRunShortcutLabel("auto") ?? ""],
        [
          t("notebook.runModeUpstreamLabel"),
          cellRunShortcutLabel("upstream") ?? "",
        ],
        [
          t("notebook.runModeCellOnlyLabel"),
          cellRunShortcutLabel("cell-only") ?? "",
        ],
        [t("notebook.runWithoutCachedResults"), `${mod} + Shift + Enter`],
        [t("keyboardShortcuts.indent"), "Tab"],
        [
          t(notebookCommands.commandMode.labelKey),
          notebookCommands.commandMode.key,
        ],
      ],
    },
    {
      label: t("keyboardShortcuts.notebook"),
      items: [
        [t(notebookCommands.editMode.labelKey), notebookCommands.editMode.key],
        [t(notebookCommands.insert.labelKey), notebookCommands.insert.key],
        [t("keyboardShortcuts.jumpToCell"), "⌥↑ / ⌥↓"],
        [t("notebook.runAll"), `${mod} + Shift + A`],
        [t("notebook.history.save"), `${mod} + S`],
        [t("notebook.runRestartAndRunAll"), "Alt + R"],
        [t("notebook.runInterrupt"), `Alt + ${mod} + I`],
      ],
    },
    {
      label: t("keyboardShortcuts.cells"),
      items: [
        [t("keyboardShortcuts.selectCell"), "↑ / ↓ / J / K"],
        [t("keyboardShortcuts.moveCell"), `${mod} + ↑ / ↓`],
        [t(notebookCommands.addAbove.labelKey), notebookCommands.addAbove.key],
        [t(notebookCommands.addBelow.labelKey), notebookCommands.addBelow.key],
        [
          t(notebookCommands.deleteCell.labelKey),
          notebookCommands.deleteCell.key,
        ],
        [
          t(notebookCommands.fullScreen.labelKey),
          notebookCommands.fullScreen.key,
        ],
        [
          t(notebookCommands.formatSql.labelKey),
          notebookCommands.formatSql.key,
        ],
        [t("keyboardShortcuts.undoCellEdit"), `${mod} + Z`],
        [t("keyboardShortcuts.redoCellEdit"), `${mod} + Shift + Z`],
      ],
    },
    {
      label: t("notebookInsert.addCell"),
      items: insertCommands
        .filter(({ kind }) =>
          ADDABLE_CELL_KINDS.some((entry) => entry === kind),
        )
        .map(({ labelKey, key }) => [t(labelKey), key]),
    },
  ];
  const groups = definitions
    .map((group) => ({
      ...group,
      items: group.items.filter(([name, key]) =>
        `${name} ${key}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    }))
    .filter((group) => group.items.length);
  return (
    <ShortcutContext.Provider value={openDialog}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
      >
        <DialogContent
          className="flex max-h-[80vh] flex-col gap-4 overflow-hidden sm:max-w-lg"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current?.focus();
          }}
        >
          <DialogTitle>{t("keyboardShortcuts.title")}</DialogTitle>
          <Input
            ref={inputRef}
            aria-label={t("keyboardShortcuts.filter")}
            placeholder={t("keyboardShortcuts.filter")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="overflow-y-auto">
            {groups.length ? (
              groups.map((group) => (
                <section key={group.label} className="mb-4">
                  <h3 className="text-muted-foreground mb-2 text-sm font-medium">
                    {group.label}
                  </h3>
                  <dl>
                    {group.items.map(([name, keys]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between gap-4 py-1 text-sm"
                      >
                        <dt>{name}</dt>
                        <dd>
                          <kbd className="bg-muted rounded px-1.5 py-0.5 text-xs">
                            {keys}
                          </kbd>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))
            ) : (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {t("keyboardShortcuts.noMatches")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ShortcutContext.Provider>
  );
}
