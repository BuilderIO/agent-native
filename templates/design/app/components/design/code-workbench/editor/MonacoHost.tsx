import type * as monaco from "monaco-editor";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { Spinner } from "@/components/ui/spinner";

import {
  readCodeWorkbenchTheme,
  type CodeWorkbenchTheme,
} from "../../code-workbench-theme";
import {
  dispatchKeybinding,
  runCommand,
  type WorkbenchCommand,
  type WorkbenchCommandContext,
} from "../commands";
import { modelRegistry } from "../model-registry";
import { useWorkbench } from "../store";
import {
  ensureMonacoEnvironment,
  monaco as monacoModule,
} from "./monaco-setup";
import { defineWorkbenchMonacoTheme } from "./monaco-theme";

const MONACO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export interface MonacoHostProps {
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  selectedNodeId?: string | null;
  selectedSelector?: string | null;
  commands: WorkbenchCommand[];
  commandContext: WorkbenchCommandContext;
}

/**
 * Single IStandaloneCodeEditor instance for the editor group. One model per
 * open tab lives in the shared model-registry; this component only swaps
 * `setModel` + view state on tab switch, so cursor/scroll/folds persist per
 * tab like real VS Code editor groups.
 */
export function MonacoHost({
  editorRef,
  selectedNodeId,
  selectedSelector,
  commands,
  commandContext,
}: MonacoHostProps) {
  const { state } = useWorkbench();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const activeUriRef = useRef<string | null>(null);
  const commandsRef = useRef(commands);
  const commandContextRef = useRef(commandContext);
  const lastSelectionKeyRef = useRef<string | null>(null);
  const [theme, setTheme] = useState<CodeWorkbenchTheme>(() => ({
    colorScheme: "light",
    values: {},
  }));

  commandsRef.current = commands;
  commandContextRef.current = commandContext;

  // Create the editor once.
  useEffect(() => {
    ensureMonacoEnvironment();
    if (!hostRef.current || editorRef.current) return;
    const editor = monacoModule.editor.create(hostRef.current, {
      value: "",
      automaticLayout: true,
      contextmenu: true,
      fontFamily: MONACO_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 20,
      minimap: { enabled: false },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      lineNumbers: "on",
      renderLineHighlight: "all",
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: true },
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "off",
      smoothScrolling: true,
      cursorBlinking: "blink",
      fontLigatures: false,
      quickSuggestions: true,
      folding: true,
      links: true,
      mouseWheelZoom: true,
      find: { addExtraSpaceOnTop: true },
    });
    editorRef.current = editor;

    // Safety net: Monaco's own Cmd+S binding (if any) is not guaranteed, and
    // the root's capture-phase keydown handler already dispatches workbench
    // commands before Monaco sees them — this addCommand is a belt-and-
    // braces fallback for save specifically. It goes through the same
    // `workbench.save` command (via runCommand) as every other invocation
    // path, not a bare `api.save()` call, so a failed save (stale version,
    // missing local write consent, network error) still surfaces a toast /
    // consent-retry here instead of failing silently.
    editor.addCommand(
      monacoModule.KeyMod.CtrlCmd | monacoModule.KeyCode.KeyS,
      () => {
        const saveCommand = commandsRef.current.find(
          (command) => command.id === "workbench.save",
        );
        if (saveCommand) {
          void runCommand(saveCommand, commandContextRef.current);
        } else {
          void commandContextRef.current.api.save();
        }
      },
    );

    // Workbench-level shortcuts (Quick Open, Command Palette, Search,
    // Explorer, sidebar toggle, tab navigation) must also work while Monaco
    // has focus — Monaco swallows keydown otherwise, so register editor
    // commands that call back into the same dispatcher the root uses.
    const editorKeyDownDisposable = editor.onKeyDown((event) => {
      const handled = dispatchKeybinding(
        event.browserEvent,
        commandsRef.current,
        commandContextRef.current,
      );
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    return () => {
      editorKeyDownDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme: watch documentElement class (light/dark) and reapply on change.
  useEffect(() => {
    const updateTheme = () => {
      const nextTheme = readCodeWorkbenchTheme(hostRef.current);
      setTheme((current) =>
        current.colorScheme === nextTheme.colorScheme &&
        JSON.stringify(current.values) === JSON.stringify(nextTheme.values)
          ? current
          : nextTheme,
      );
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", updateTheme);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateTheme);
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    monacoModule.editor.setTheme(defineWorkbenchMonacoTheme(theme));
  }, [theme, editorRef]);

  // Active tab change: save view state for the outgoing model, set the
  // incoming model (creating lazily from the buffer if needed), restore its
  // view state, and focus.
  const activeUri = state.activeUri;
  const activeBuffer = activeUri ? state.buffers[activeUri] : null;
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const previousUri = activeUriRef.current;
    if (previousUri && previousUri !== activeUri) {
      modelRegistry.saveViewState(previousUri, editor.saveViewState());
    }
    activeUriRef.current = activeUri;
    if (!activeUri) {
      editor.setModel(null);
      return;
    }
    const entry = modelRegistry.get(activeUri);
    if (!entry) {
      // Buffer still loading; wait for the next render once the model
      // registry has an entry (store.loadBuffer creates it on read success).
      return;
    }
    if (editor.getModel() !== entry.model) {
      editor.setModel(entry.model);
      const viewState = modelRegistry.getViewState(activeUri);
      if (viewState) editor.restoreViewState(viewState);
      editor.focus();
    }
    const meta = activeBuffer;
    editor.updateOptions({
      readOnly: Boolean(meta?.readonly),
      readOnlyMessage: meta?.readonly
        ? {
            value:
              "This source is read-only in the current workspace." /* i18n-ignore */,
          }
        : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUri, activeBuffer?.readonly, activeBuffer?.loading, editorRef]);

  // Dirty tracking is owned by the store (subscribed at model creation), not
  // here — models are created async after their tab appears, so a tab-list
  // keyed subscription would miss freshly loaded buffers.

  // Selection reveal: find data-agent-native-node-id / data-code-layer-id /
  // selector in the active model's content and reveal+select the match.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeUri) return;
    const entry = modelRegistry.get(activeUri);
    if (!entry) return;
    const key = [
      activeUri,
      selectedNodeId ?? "",
      selectedSelector ?? "",
      activeBuffer?.savedVersionHash ?? "",
    ].join(":");
    if (lastSelectionKeyRef.current === key) return;
    lastSelectionKeyRef.current = key;
    if (!selectedNodeId && !selectedSelector) return;
    const model = entry.model;
    const content = model.getValue();
    const targets: string[] = [];
    if (selectedNodeId) {
      targets.push(`data-agent-native-node-id="${selectedNodeId}"`);
      targets.push(`data-code-layer-id="${selectedNodeId}"`);
      targets.push(selectedNodeId);
    }
    if (selectedSelector) targets.push(selectedSelector);
    for (const target of targets) {
      const index = content.indexOf(target);
      if (index < 0) continue;
      const start = model.getPositionAt(index);
      const end = model.getPositionAt(index + target.length);
      const range = new monacoModule.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      editor.setSelection(range);
      editor.revealRangeInCenter(range, monacoModule.editor.ScrollType.Smooth);
      return;
    }
  }, [
    activeUri,
    activeBuffer?.savedVersionHash,
    editorRef,
    selectedNodeId,
    selectedSelector,
  ]);

  const loading = Boolean(activeUri && activeBuffer?.loading);

  return (
    <div className="absolute inset-0">
      <div
        ref={hostRef}
        data-testid="design-code-monaco-editor"
        className="absolute inset-0"
      />
      {loading ? (
        <div className="absolute inset-0 grid place-items-center bg-[var(--workbench-editor-bg)]/80 text-[var(--workbench-muted-fg)]">
          <Spinner className="size-4" />
        </div>
      ) : null}
    </div>
  );
}
