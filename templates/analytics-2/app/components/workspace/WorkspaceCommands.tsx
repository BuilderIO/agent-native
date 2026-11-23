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

import { useOpenKeyboardShortcuts } from "@/components/notebook/KeyboardShortcutsDialog";
import {
  formatThemeCommandLabel,
  useThemePreference,
} from "@/components/shell/theme-preference";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type WorkspaceCommand = {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<unknown>;
};
const CommandContext = createContext<{
  register: (commands: WorkspaceCommand[]) => () => void;
  open: () => void;
} | null>(null);

export function useNotebookCommands(commands: WorkspaceCommand[]) {
  const context = useContext(CommandContext);
  const latest = useRef(commands);
  latest.current = commands;
  const metadata = JSON.stringify(
    commands.map(({ run: _run, ...entry }) => entry),
  );
  useEffect(() => {
    if (!context) return;
    const entries = JSON.parse(metadata) as Omit<WorkspaceCommand, "run">[];
    return context.register(
      entries.map((entry) => ({
        ...entry,
        run: () => latest.current.find(({ id }) => id === entry.id)?.run(),
      })),
    );
  }, [context?.register, metadata]);
  return context?.open;
}

function WorkspaceCommandPaletteContent({
  commands,
  notebook,
  project,
  query,
  onQueryChange,
  onClose,
}: {
  commands: WorkspaceCommand[];
  notebook: WorkspaceCommand[];
  project: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const showHelp = useOpenKeyboardShortcuts();
  const { preference, setPreference, systemTheme } = useThemePreference();
  const preferencesGroup = t("analytics.settings.workspace.preferences");
  const entries: WorkspaceCommand[] = [
    ...commands,
    ...(project ? notebook : []),
    {
      id: "theme-system",
      label: formatThemeCommandLabel("system", systemTheme),
      group: preferencesGroup,
      disabled: preference === "system",
      run: () => setPreference("system"),
    },
    {
      id: "theme-light",
      label: formatThemeCommandLabel("light", systemTheme),
      group: preferencesGroup,
      disabled: preference === "light",
      run: () => setPreference("light"),
    },
    {
      id: "theme-dark",
      label: formatThemeCommandLabel("dark", systemTheme),
      group: preferencesGroup,
      disabled: preference === "dark",
      run: () => setPreference("dark"),
    },
    {
      id: "shortcuts",
      label: t("keyboardShortcuts.help"),
      group: t("commandPalette.help"),
      shortcut: "Mod + Shift + /",
      run: showHelp,
    },
  ];
  const groups = [...new Set(entries.map(({ group }) => group))];
  return (
    <>
      <DialogTitle>{t("commandPalette.title")}</DialogTitle>
      <Command>
        <CommandInput
          autoFocus
          aria-label={t("commandPalette.filter")}
          placeholder={t("commandPalette.filter")}
          value={query}
          onValueChange={onQueryChange}
        />
        <CommandList>
          <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {entries
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.label}
                    disabled={Boolean(entry.disabled)}
                    onSelect={() => {
                      if (entry.disabled) return;
                      if (document.activeElement instanceof HTMLElement)
                        document.activeElement.blur();
                      onClose();
                      requestAnimationFrame(() => {
                        void entry.run();
                      });
                    }}
                  >
                    <span>{entry.label}</span>
                    {entry.shortcut ? (
                      <kbd className="ml-auto pl-4 text-xs text-muted-foreground">
                        {entry.shortcut}
                      </kbd>
                    ) : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </>
  );
}

export function WorkspaceCommands({
  children,
  commands,
  enabled,
  project,
}: {
  children: ReactNode;
  commands: WorkspaceCommand[];
  enabled: boolean;
  project: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notebook, setNotebook] = useState<WorkspaceCommand[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  const openPalette = useCallback(() => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    setOpen(true);
  }, []);
  const register = useCallback((entries: WorkspaceCommand[]) => {
    setNotebook(entries);
    return () => setNotebook([]);
  }, []);
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "p"
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]):not([data-closed]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([data-closed]):not([hidden])',
        )
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (
        !(event.ctrlKey || event.metaKey) &&
        !(project && (target?.closest(".nb-root") || target === document.body))
      )
        return;
      event.preventDefault();
      openPalette();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [enabled, project, openPalette]);
  return (
    <CommandContext.Provider value={{ register, open: openPalette }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          {open ? (
            <WorkspaceCommandPaletteContent
              commands={commands}
              notebook={notebook}
              project={project}
              query={query}
              onQueryChange={setQuery}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </CommandContext.Provider>
  );
}
