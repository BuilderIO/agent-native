import {
  readClientAppState,
  setClientAppState,
} from "@agent-native/core/client";
import type * as monaco from "monaco-editor";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import {
  readCodeWorkbenchTheme,
  type CodeWorkbenchTheme,
} from "../code-workbench-theme";
import {
  createCoreCommands,
  dispatchKeybinding,
  formatKeybinding,
  type WorkbenchCommand,
  type WorkbenchCommandContext,
  type WorkbenchUiHandles,
} from "./commands";
import { Breadcrumbs } from "./editor/Breadcrumbs";
import { BufferSyncGroup } from "./editor/BufferSync";
import { EditorTabs } from "./editor/EditorTabs";
import { ensureMonacoEnvironment } from "./editor/monaco-setup";
import { MonacoHost } from "./editor/MonacoHost";
import { StatusBar } from "./editor/StatusBar";
import { useFormatOnFirstOpen } from "./format/format-on-open";
import { registerPrettierFormatting } from "./format/prettier-format";
import { modelRegistry } from "./model-registry";
import { QuickInput, type QuickInputHandle } from "./quickinput/QuickInput";
import { SideBar } from "./SideBar";
import { useWorkbench, WorkbenchProvider } from "./store";
import { createWorkspaceProviders } from "./workspace/create-providers";
import {
  parseWorkbenchUri,
  providerKindFromKey,
  workbenchUri,
} from "./workspace/types";

export interface CodeWorkbenchLocalhostConnection {
  connectionId: string;
  label: string;
}

export interface CodeWorkbenchActiveFile {
  path: string;
  fileId?: string;
  dirty: boolean;
  versionHash?: string;
  backendKind: "virtual-inline" | "localhost-bridge";
}

export interface CodeWorkbenchProps {
  designId: string;
  canEdit: boolean;
  activeFileId?: string | null;
  activeFilename?: string | null;
  selectedNodeId?: string | null;
  selectedSelector?: string | null;
  localhostConnections?: CodeWorkbenchLocalhostConnection[];
  onActiveFileChange?: (file: CodeWorkbenchActiveFile | null) => void;
  onRequestLocalWriteConsent?: (
    connectionId: string,
    retry: () => void,
    filePath?: string,
  ) => void;
  extraCommands?: WorkbenchCommand[];
}

export function CodeWorkbench(props: CodeWorkbenchProps) {
  const providers = useMemo(
    () =>
      createWorkspaceProviders({
        designId: props.designId,
        canEdit: props.canEdit,
        localhostConnections: props.localhostConnections ?? [],
      }),
    [props.designId, props.canEdit, props.localhostConnections],
  );
  return (
    <WorkbenchProvider key={props.designId} providers={providers}>
      <CodeWorkbenchInner {...props} />
    </WorkbenchProvider>
  );
}

function CodeWorkbenchInner({
  designId,
  canEdit,
  activeFileId,
  activeFilename,
  selectedNodeId,
  selectedSelector,
  onActiveFileChange,
  onRequestLocalWriteConsent,
  extraCommands,
}: CodeWorkbenchProps) {
  const { state, api } = useWorkbench();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const quickInputRef = useRef<QuickInputHandle | null>(null);
  const lastExternalTargetKeyRef = useRef<string | null>(null);
  const [searchSeed, setSearchSeed] = useState<{
    value?: string;
    token: number;
  }>({ token: 0 });
  const [explorerFocusToken, setExplorerFocusToken] = useState(0);
  const [theme, setTheme] = useState<CodeWorkbenchTheme>(() => ({
    colorScheme: "light",
    values: {},
  }));

  useState(() => {
    ensureMonacoEnvironment();
    registerPrettierFormatting();
    return null;
  });

  // Stable automation/E2E handle (used by Playwright specs and QA tooling —
  // Monaco's EditContext-based input cannot be driven via synthetic DOM
  // events alone).
  useEffect(() => {
    const target = window as typeof window & {
      __designCodeWorkbench?: unknown;
    };
    target.__designCodeWorkbench = { api, modelRegistry };
    return () => {
      delete target.__designCodeWorkbench;
    };
  }, [api]);

  useFormatOnFirstOpen({ enabled: canEdit });

  useEffect(() => {
    const updateTheme = () => {
      const nextTheme = readCodeWorkbenchTheme(rootRef.current);
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

  const ui = useMemo<WorkbenchUiHandles>(
    () => ({
      openQuickInput: (prefill) => quickInputRef.current?.open(prefill),
      focusExplorer: () => {
        api.setSideView("explorer");
        setExplorerFocusToken((token) => token + 1);
      },
      openSearch: (seed) => {
        api.setSideView("search");
        setSearchSeed((current) => ({ value: seed, token: current.token + 1 }));
      },
      getEditor: () => editorRef.current,
      reportError: (message) => toast.error(message),
      requestLocalWriteConsent: onRequestLocalWriteConsent
        ? (connectionId, retry, filePath) =>
            onRequestLocalWriteConsent(connectionId, retry, filePath)
        : undefined,
    }),
    [api, onRequestLocalWriteConsent],
  );

  const commands = useMemo(
    () => [...createCoreCommands(), ...(extraCommands ?? [])],
    [extraCommands],
  );
  const commandContext = useMemo<WorkbenchCommandContext>(
    () => ({ api, ui }),
    [api, ui],
  );

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      dispatchKeybinding(event.nativeEvent, commands, commandContext);
    },
    [commands, commandContext],
  );

  // Restore and persist the workbench session (open tabs, active file,
  // sidebar layout) per design via application state, so the agent can also
  // observe it and reopening the design restores the editor session.
  const persistenceKey = `code-workbench:${designId}`;
  const restoredRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const persisted =
          await readClientAppState<PersistedWorkbenchSession>(persistenceKey);
        if (cancelled || !persisted || typeof persisted !== "object") return;
        const providerKeys = new Set(
          api.listProviders().map((provider) => provider.key),
        );
        const tabs = Array.isArray(persisted.tabs) ? persisted.tabs : [];
        for (const tab of tabs) {
          if (!tab?.providerKey || !tab.path) continue;
          if (!providerKeys.has(tab.providerKey)) continue;
          void api.openFile(tab.providerKey, tab.path, {
            preview: tab.preview === true,
            activate: false,
          });
        }
        if (persisted.activeUri) {
          const { providerKey, path } = parseWorkbenchUri(persisted.activeUri);
          if (
            providerKeys.has(providerKey) &&
            tabs.some(
              (tab) => tab.providerKey === providerKey && tab.path === path,
            )
          ) {
            void api.openFile(providerKey, path, {
              preview: false,
              activate: true,
            });
          }
        }
        if (persisted.sideView === "search") api.setSideView("search");
        if (typeof persisted.sidebarWidth === "number") {
          api.setSidebarWidth(persisted.sidebarWidth);
        }
        if (persisted.sidebarVisible === false) api.toggleSidebar();
      } catch {
        // Session restore is best-effort.
      } finally {
        if (!cancelled) restoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, persistenceKey]);

  useEffect(() => {
    if (!restoredRef.current) return;
    const timer = window.setTimeout(() => {
      const session: PersistedWorkbenchSession = {
        tabs: state.tabs.map((tab) => ({
          providerKey: tab.providerKey,
          path: tab.path,
          preview: tab.preview,
        })),
        activeUri: state.activeUri,
        sideView: state.sideView,
        sidebarWidth: state.sidebarWidth,
        sidebarVisible: state.sidebarVisible,
      };
      setClientAppState(persistenceKey, session).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    persistenceKey,
    state.tabs,
    state.activeUri,
    state.sideView,
    state.sidebarWidth,
    state.sidebarVisible,
  ]);

  // Agent/URL-driven file targeting (navigate --leftPanel code --fileId …).
  const inlineProviderKey = `inline:${designId}`;
  useEffect(() => {
    if (!activeFileId && !activeFilename) {
      lastExternalTargetKeyRef.current = null;
      return;
    }
    const targetKey = [activeFileId ?? "", activeFilename ?? ""].join(":");
    if (lastExternalTargetKeyRef.current === targetKey) return;
    lastExternalTargetKeyRef.current = targetKey;
    void (async () => {
      const provider = api.getProvider(inlineProviderKey);
      if (!provider) return;
      try {
        const files = await provider.listFiles();
        const match = files.find(
          (file) =>
            (activeFileId && file.fileId === activeFileId) ||
            (activeFilename && file.path === activeFilename),
        );
        if (match) {
          await api.openFile(inlineProviderKey, match.path, { preview: false });
        }
      } catch {
        // File targeting is best-effort; the explorer still works.
      }
    })();
  }, [activeFileId, activeFilename, api, inlineProviderKey]);

  // Report the active file to the design editor shell / agent context.
  const activeBuffer = state.activeUri ? state.buffers[state.activeUri] : null;
  useEffect(() => {
    if (!state.activeUri || !activeBuffer) {
      onActiveFileChange?.(null);
      return;
    }
    const { providerKey, path } = parseWorkbenchUri(state.activeUri);
    onActiveFileChange?.({
      path,
      fileId: activeBuffer.fileId,
      dirty: activeBuffer.dirty,
      versionHash: activeBuffer.savedVersionHash,
      backendKind:
        providerKindFromKey(providerKey) === "inline"
          ? "virtual-inline"
          : "localhost-bridge",
    });
  }, [
    state.activeUri,
    activeBuffer?.fileId,
    activeBuffer?.dirty,
    activeBuffer?.savedVersionHash,
    onActiveFileChange,
  ]);

  // Sidebar resize.
  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = api.getState().sidebarWidth;
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent) => {
        api.setSidebarWidth(startWidth + (moveEvent.clientX - startX));
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [api],
  );

  const activeTabUri = state.activeUri;
  const activePath = activeTabUri ? parseWorkbenchUri(activeTabUri).path : null;

  return (
    <div
      ref={rootRef}
      data-hotkeys-scope="text"
      data-testid="design-code-workbench"
      tabIndex={-1}
      onKeyDownCapture={handleKeyDownCapture}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--workbench-bg)] text-[var(--workbench-fg)] outline-none"
      style={theme.values as CSSProperties}
    >
      <div className="flex min-h-0 flex-1">
        {state.sidebarVisible ? (
          <>
            <div
              style={{ width: state.sidebarWidth }}
              className="flex min-h-0 shrink-0 flex-col border-r border-[var(--workbench-border)] bg-[var(--workbench-sidebar-bg)]"
            >
              <SideBar
                designId={designId}
                searchSeed={searchSeed}
                explorerFocusToken={explorerFocusToken}
                onRequestLocalWriteConsent={onRequestLocalWriteConsent}
              />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={handleSidebarResizeStart}
              className="-ml-[3px] w-[5px] shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--workbench-accent)]/40"
            />
          </>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--workbench-editor-bg)]">
          <EditorTabs />
          {activeTabUri && activePath && activePath.includes("/") ? (
            <Breadcrumbs />
          ) : null}
          <div className="relative min-h-0 flex-1">
            <MonacoHost
              editorRef={editorRef}
              selectedNodeId={selectedNodeId}
              selectedSelector={selectedSelector}
              commands={commands}
              commandContext={commandContext}
            />
            {!activeTabUri ? <WorkbenchEmptyState /> : null}
          </div>
        </div>
      </div>
      <StatusBar
        editorRef={editorRef}
        onGoToLine={() => ui.openQuickInput(":")}
      />
      <QuickInput
        ref={quickInputRef}
        commands={commands}
        context={commandContext}
      />
      <BufferSyncGroup designId={designId} />
    </div>
  );
}

interface PersistedWorkbenchSession {
  tabs: Array<{ providerKey: string; path: string; preview?: boolean }>;
  activeUri: string | null;
  sideView?: "explorer" | "search";
  sidebarWidth?: number;
  sidebarVisible?: boolean;
}

const EMPTY_STATE_ROWS: Array<{ label: string; binding: string }> = [
  { label: "Go to File" /* i18n-ignore */, binding: "$mod+p" },
  { label: "Command Palette" /* i18n-ignore */, binding: "$mod+shift+p" },
  { label: "Find in Files" /* i18n-ignore */, binding: "$mod+shift+f" },
  { label: "Toggle Sidebar" /* i18n-ignore */, binding: "$mod+b" },
];

function WorkbenchEmptyState() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[var(--workbench-editor-bg)]">
      <div className="flex flex-col gap-2.5">
        {EMPTY_STATE_ROWS.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-8 text-[12px] text-[var(--workbench-muted-fg)]"
          >
            <span>{row.label}</span>
            <kbd
              className={cn(
                "rounded-[4px] border border-[var(--workbench-border)] bg-[var(--workbench-surface-bg)]",
                "px-1.5 py-0.5 font-sans text-[11px] text-[var(--workbench-muted-fg)]",
              )}
            >
              {formatKeybinding(row.binding)}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

export { workbenchUri };
