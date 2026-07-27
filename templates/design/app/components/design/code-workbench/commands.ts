import type * as monaco from "monaco-editor";

import type { WorkbenchApi } from "./store";

/**
 * Workbench command registry + keybinding matching.
 *
 * Commands power the command palette (⇧⌘P) and the workbench-level keybinding
 * dispatcher on the workbench root. Monaco's own text-editing keybindings
 * (multi-cursor, find, line moves…) are NOT registered here — Monaco owns them
 * while the editor has focus.
 *
 * Keybinding strings: lowercase tokens joined by `+`. Modifier tokens:
 * `$mod` (⌘ on macOS, Ctrl elsewhere), `ctrl`, `alt`, `shift`. Key token is
 * last: a letter/digit, `f1`–`f12`, `[`, `]`, `arrowleft`, `arrowright`,
 * `arrowup`, `arrowdown`, `enter`, `escape`.
 */

export interface WorkbenchUiHandles {
  /** Open the quick input overlay with the given prefill ("" | ">" | ":" …). */
  openQuickInput(prefill: string): void;
  /** Focus the explorer tree (switching the side view if needed). */
  focusExplorer(): void;
  /** Open the search view, optionally seeding the query. */
  openSearch(seed?: string): void;
  /** The live Monaco editor instance, when mounted. */
  getEditor(): monaco.editor.IStandaloneCodeEditor | null;
  /** Surface a command error to the user (toast). */
  reportError(message: string): void;
  /**
   * Ask the shell to run the local-file write-consent flow, then retry the
   * failed operation. Wired to the design editor's consent dialog.
   */
  requestLocalWriteConsent?(
    connectionId: string,
    retry: () => void,
    filePath?: string,
  ): void;
}

/**
 * Detect the localhost provider's consent error without importing its module
 * (keeps the command registry decoupled from provider implementations).
 */
function localWriteConsentDetails(
  error: unknown,
): { connectionId: string; filePath?: string } | null {
  if (
    error instanceof Error &&
    error.name === "LocalWriteConsentRequiredError" &&
    typeof (error as { connectionId?: unknown }).connectionId === "string"
  ) {
    const details = error as unknown as {
      connectionId: string;
      path?: unknown;
    };
    return {
      connectionId: details.connectionId,
      filePath: typeof details.path === "string" ? details.path : undefined,
    };
  }
  return null;
}

async function saveWithConsentRetry(
  context: WorkbenchCommandContext,
  run: () => Promise<void>,
) {
  try {
    await run();
  } catch (error) {
    const consent = localWriteConsentDetails(error);
    if (consent && context.ui.requestLocalWriteConsent) {
      context.ui.requestLocalWriteConsent(
        consent.connectionId,
        () => {
          run().catch((retryError) => {
            context.ui.reportError(
              retryError instanceof Error
                ? retryError.message
                : "Could not save file" /* i18n-ignore */,
            );
          });
        },
        consent.filePath,
      );
      return;
    }
    throw error;
  }
}

export interface WorkbenchCommandContext {
  api: WorkbenchApi;
  ui: WorkbenchUiHandles;
}

export interface WorkbenchCommand {
  id: string;
  title: string;
  category?: string;
  keybindings?: string[];
  /** Hide from the command palette (still keybinding-dispatchable). */
  showInPalette?: boolean;
  when?: (context: WorkbenchCommandContext) => boolean;
  run: (context: WorkbenchCommandContext) => void | Promise<void>;
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

interface ParsedKeybinding {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function parseKeybinding(binding: string): ParsedKeybinding {
  const tokens = binding.toLowerCase().split("+");
  const parsed: ParsedKeybinding = {
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const token of tokens) {
    if (token === "$mod") parsed.mod = true;
    else if (token === "ctrl") parsed.ctrl = true;
    else if (token === "alt") parsed.alt = true;
    else if (token === "shift") parsed.shift = true;
    else parsed.key = token;
  }
  return parsed;
}

function eventKeyToken(event: KeyboardEvent): string {
  // Bracket keys shift on some layouts; match by physical code.
  if (event.code === "BracketLeft") return "[";
  if (event.code === "BracketRight") return "]";
  const key = event.key.toLowerCase();
  if (key === " ") return "space";
  return key;
}

export function matchKeybinding(
  event: KeyboardEvent,
  binding: string,
): boolean {
  const parsed = parseKeybinding(binding);
  const wantMeta = IS_MAC ? parsed.mod : false;
  const wantCtrl = parsed.ctrl || (!IS_MAC && parsed.mod);
  if (event.metaKey !== wantMeta) return false;
  if (event.ctrlKey !== wantCtrl) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.shiftKey !== parsed.shift) return false;
  return eventKeyToken(event) === parsed.key;
}

const MAC_KEY_LABELS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↩",
  escape: "⎋",
};

/** Human-readable keybinding, e.g. "⇧⌘P" on macOS or "Ctrl+Shift+P". */
export function formatKeybinding(binding: string): string {
  const parsed = parseKeybinding(binding);
  const keyLabel =
    parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key;
  if (IS_MAC) {
    return [
      parsed.ctrl ? "⌃" : "",
      parsed.alt ? "⌥" : "",
      parsed.shift ? "⇧" : "",
      parsed.mod ? "⌘" : "",
      MAC_KEY_LABELS[parsed.key] ??
        (keyLabel.startsWith("f") && keyLabel.length <= 3
          ? keyLabel.toUpperCase()
          : keyLabel),
    ].join("");
  }
  const parts: string[] = [];
  if (parsed.mod || parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(keyLabel.length === 1 ? keyLabel.toUpperCase() : keyLabel);
  return parts.join("+");
}

/**
 * Dispatch a keydown against the command list. Returns true (and prevents
 * default) when a command ran.
 */
export function dispatchKeybinding(
  event: KeyboardEvent,
  commands: WorkbenchCommand[],
  context: WorkbenchCommandContext,
): boolean {
  for (const command of commands) {
    if (!command.keybindings?.length) continue;
    if (command.when && !command.when(context)) continue;
    if (
      command.keybindings.some((binding) => matchKeybinding(event, binding))
    ) {
      event.preventDefault();
      event.stopPropagation();
      void runCommand(command, context);
      return true;
    }
  }
  return false;
}

export async function runCommand(
  command: WorkbenchCommand,
  context: WorkbenchCommandContext,
) {
  try {
    await command.run(context);
  } catch (error) {
    context.ui.reportError(
      error instanceof Error
        ? error.message
        : "Command failed" /* i18n-ignore */,
    );
  }
}

/**
 * Core workbench commands. Packet components may append their own commands via
 * the `extraCommands` prop on CodeWorkbench (not by editing this list).
 */
export function createCoreCommands(): WorkbenchCommand[] {
  return [
    {
      id: "workbench.save",
      title: "File: Save" /* i18n-ignore */,
      keybindings: ["$mod+s"],
      run: (context) => saveWithConsentRetry(context, () => context.api.save()),
    },
    {
      id: "workbench.saveAll",
      title: "File: Save All" /* i18n-ignore */,
      keybindings: ["$mod+alt+s"],
      run: (context) =>
        saveWithConsentRetry(context, () => context.api.saveAll()),
    },
    {
      id: "workbench.quickOpen",
      title: "Go to File…" /* i18n-ignore */,
      keybindings: ["$mod+p"],
      run: ({ ui }) => ui.openQuickInput(""),
    },
    {
      id: "workbench.commandPalette",
      title: "Command Palette…" /* i18n-ignore */,
      keybindings: ["$mod+shift+p", "f1"],
      run: ({ ui }) => ui.openQuickInput(">"),
    },
    {
      id: "workbench.search",
      title: "Search: Find in Files" /* i18n-ignore */,
      keybindings: ["$mod+shift+f"],
      run: ({ ui }) => {
        const editor = ui.getEditor();
        const selection = editor?.getSelection();
        const seed =
          selection && !selection.isEmpty()
            ? (editor?.getModel()?.getValueInRange(selection) ?? undefined)
            : undefined;
        ui.openSearch(seed);
      },
    },
    {
      id: "workbench.explorer",
      title: "View: Show Explorer" /* i18n-ignore */,
      keybindings: ["$mod+shift+e"],
      run: ({ ui }) => ui.focusExplorer(),
    },
    {
      id: "workbench.toggleSidebar",
      title: "View: Toggle Sidebar" /* i18n-ignore */,
      keybindings: ["$mod+b"],
      run: ({ api }) => api.toggleSidebar(),
    },
    {
      id: "workbench.nextTab",
      title: "View: Next Editor" /* i18n-ignore */,
      keybindings: ["$mod+shift+]", "$mod+alt+arrowright"],
      run: ({ api }) => api.activateNextTab(1),
    },
    {
      id: "workbench.previousTab",
      title: "View: Previous Editor" /* i18n-ignore */,
      keybindings: ["$mod+shift+[", "$mod+alt+arrowleft"],
      run: ({ api }) => api.activateNextTab(-1),
    },
    {
      id: "workbench.closeTab",
      title: "View: Close Editor" /* i18n-ignore */,
      showInPalette: true,
      run: ({ api }) => {
        const active = api.getState().activeUri;
        if (active) api.closeTab(active);
      },
    },
    {
      id: "editor.formatDocument",
      title: "Format Document" /* i18n-ignore */,
      // Shift+Alt+F is Monaco's built-in binding while the editor has focus;
      // this palette entry covers discoverability.
      run: ({ ui }) => {
        void ui.getEditor()?.getAction("editor.action.formatDocument")?.run();
      },
    },
    {
      id: "editor.gotoSymbol",
      title: "Go to Symbol in Editor…" /* i18n-ignore */,
      keybindings: ["$mod+shift+o"],
      run: ({ ui }) => {
        ui.getEditor()?.focus();
        void ui.getEditor()?.getAction("editor.action.quickOutline")?.run();
      },
    },
    {
      id: "editor.gotoLine",
      title: "Go to Line/Column…" /* i18n-ignore */,
      keybindings: ["ctrl+g"],
      run: ({ ui }) => ui.openQuickInput(":"),
    },
  ];
}
