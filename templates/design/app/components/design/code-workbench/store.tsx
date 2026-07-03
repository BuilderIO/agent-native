import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { modelRegistry } from "./model-registry";
import {
  parseWorkbenchUri,
  workbenchUri,
  WorkspaceStaleVersionError,
  type WorkspaceProvider,
  type WorkspaceReadResult,
} from "./workspace/types";

export type SideView = "explorer" | "search";

export interface EditorTab {
  uri: string;
  providerKey: string;
  path: string;
  /** Preview tabs (italic label) are replaced by the next preview open. */
  preview: boolean;
}

export interface BufferMeta {
  uri: string;
  loading: boolean;
  error?: string;
  dirty: boolean;
  /** File changed externally while the buffer had unsaved edits. */
  conflict: boolean;
  saving: boolean;
  readonly: boolean;
  language?: string;
  fileId?: string;
  savedVersionHash?: string;
  lastSavedAt?: number;
}

export interface WorkbenchState {
  tabs: EditorTab[];
  activeUri: string | null;
  /** Most-recently-used uris, most recent first. Drives quick open + close. */
  mru: string[];
  buffers: Record<string, BufferMeta>;
  sideView: SideView;
  sidebarVisible: boolean;
  sidebarWidth: number;
}

const INITIAL_STATE: WorkbenchState = {
  tabs: [],
  activeUri: null,
  mru: [],
  buffers: {},
  sideView: "explorer",
  sidebarVisible: true,
  sidebarWidth: 240,
};

type WorkbenchAction =
  | { type: "OPEN_TAB"; tab: EditorTab; activate: boolean }
  | { type: "PIN_TAB"; uri: string }
  | { type: "CLOSE_TABS"; uris: string[]; nextActive: string | null }
  | { type: "SET_ACTIVE"; uri: string | null }
  | { type: "REORDER_TABS"; fromIndex: number; toIndex: number }
  | { type: "SET_BUFFER"; meta: BufferMeta }
  | { type: "PATCH_BUFFER"; uri: string; patch: Partial<BufferMeta> }
  | { type: "REMOVE_BUFFERS"; uris: string[] }
  | { type: "SET_SIDE_VIEW"; view: SideView }
  | { type: "SET_SIDEBAR_VISIBLE"; visible: boolean }
  | { type: "SET_SIDEBAR_WIDTH"; width: number }
  | { type: "RENAME_URI"; uri: string; nextUri: string; nextPath: string }
  | { type: "RESET" };

function bumpMru(mru: string[], uri: string): string[] {
  return [uri, ...mru.filter((entry) => entry !== uri)];
}

function reducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case "OPEN_TAB": {
      const existing = state.tabs.find((tab) => tab.uri === action.tab.uri);
      let tabs = state.tabs;
      if (existing) {
        // Re-opening an existing preview tab as pinned pins it in place.
        if (existing.preview && !action.tab.preview) {
          tabs = tabs.map((tab) =>
            tab.uri === existing.uri ? { ...tab, preview: false } : tab,
          );
        }
      } else if (action.tab.preview) {
        // A new preview tab replaces the current preview tab in place.
        const previewIndex = tabs.findIndex((tab) => tab.preview);
        if (previewIndex >= 0) {
          tabs = tabs.map((tab, index) =>
            index === previewIndex ? action.tab : tab,
          );
        } else {
          tabs = [...tabs, action.tab];
        }
      } else {
        tabs = [...tabs, action.tab];
      }
      return {
        ...state,
        tabs,
        activeUri: action.activate ? action.tab.uri : state.activeUri,
        mru: action.activate ? bumpMru(state.mru, action.tab.uri) : state.mru,
      };
    }
    case "PIN_TAB":
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.uri === action.uri ? { ...tab, preview: false } : tab,
        ),
      };
    case "CLOSE_TABS": {
      const closing = new Set(action.uris);
      return {
        ...state,
        tabs: state.tabs.filter((tab) => !closing.has(tab.uri)),
        mru: state.mru.filter((uri) => !closing.has(uri)),
        activeUri: closing.has(state.activeUri ?? "")
          ? action.nextActive
          : state.activeUri,
      };
    }
    case "SET_ACTIVE":
      return {
        ...state,
        activeUri: action.uri,
        mru: action.uri ? bumpMru(state.mru, action.uri) : state.mru,
      };
    case "REORDER_TABS": {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(action.fromIndex, 1);
      if (!moved) return state;
      tabs.splice(action.toIndex, 0, moved);
      return { ...state, tabs };
    }
    case "SET_BUFFER":
      return {
        ...state,
        buffers: { ...state.buffers, [action.meta.uri]: action.meta },
      };
    case "PATCH_BUFFER": {
      const current = state.buffers[action.uri];
      if (!current) return state;
      return {
        ...state,
        buffers: {
          ...state.buffers,
          [action.uri]: { ...current, ...action.patch },
        },
      };
    }
    case "REMOVE_BUFFERS": {
      const buffers = { ...state.buffers };
      for (const uri of action.uris) delete buffers[uri];
      return { ...state, buffers };
    }
    case "SET_SIDE_VIEW":
      return { ...state, sideView: action.view, sidebarVisible: true };
    case "SET_SIDEBAR_VISIBLE":
      return { ...state, sidebarVisible: action.visible };
    case "SET_SIDEBAR_WIDTH":
      return {
        ...state,
        sidebarWidth: Math.min(360, Math.max(160, action.width)),
      };
    case "RENAME_URI": {
      const { providerKey } = parseWorkbenchUri(action.nextUri);
      const buffers = { ...state.buffers };
      const meta = buffers[action.uri];
      if (meta) {
        delete buffers[action.uri];
        buffers[action.nextUri] = { ...meta, uri: action.nextUri };
      }
      return {
        ...state,
        buffers,
        tabs: state.tabs.map((tab) =>
          tab.uri === action.uri
            ? {
                uri: action.nextUri,
                providerKey,
                path: action.nextPath,
                preview: tab.preview,
              }
            : tab,
        ),
        mru: state.mru.map((uri) =>
          uri === action.uri ? action.nextUri : uri,
        ),
        activeUri:
          state.activeUri === action.uri ? action.nextUri : state.activeUri,
      };
    }
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

export interface OpenFileOptions {
  preview?: boolean;
  activate?: boolean;
}

export interface BufferLoadedEvent {
  uri: string;
  providerKey: string;
  path: string;
  read: WorkspaceReadResult;
  /** True the first time this buffer is loaded in the session. */
  firstLoad: boolean;
}

export interface WorkbenchApi {
  getState(): WorkbenchState;
  getProvider(providerKey: string): WorkspaceProvider | undefined;
  listProviders(): WorkspaceProvider[];
  openFile(
    providerKey: string,
    path: string,
    options?: OpenFileOptions,
  ): Promise<string>;
  setActive(uri: string): void;
  pinTab(uri: string): void;
  closeTab(uri: string): void;
  closeOthers(uri: string): void;
  closeSaved(): void;
  closeAll(): void;
  reorderTabs(fromIndex: number, toIndex: number): void;
  activateNextTab(direction: 1 | -1): void;
  markDirty(uri: string, dirty: boolean): void;
  save(uri?: string): Promise<void>;
  saveAll(): Promise<void>;
  reloadBuffer(uri: string): Promise<void>;
  applyExternalRead(uri: string, read: WorkspaceReadResult): void;
  createFile(providerKey: string, path: string): Promise<void>;
  renameFile(
    providerKey: string,
    path: string,
    nextPath: string,
  ): Promise<void>;
  deleteFile(providerKey: string, path: string): Promise<void>;
  setSideView(view: SideView): void;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  refreshFileLists(): void;
  /** Register a listener fired after a buffer's content is (re)loaded. */
  onBufferLoaded(listener: (event: BufferLoadedEvent) => void): () => void;
  /** Register a listener fired when the file list should be refetched. */
  onFilesChanged(listener: () => void): () => void;
}

interface WorkbenchContextValue {
  state: WorkbenchState;
  api: WorkbenchApi;
  providers: WorkspaceProvider[];
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

export function useWorkbench(): WorkbenchContextValue {
  const value = useContext(WorkbenchContext);
  if (!value) {
    throw new Error("useWorkbench must be used inside WorkbenchProvider");
  }
  return value;
}

export function WorkbenchProvider({
  providers,
  children,
}: {
  providers: WorkspaceProvider[];
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const loadedOnceRef = useRef(new Set<string>());
  /**
   * Version hashes this client has itself loaded or produced, per buffer.
   * External reads (BufferSync polling) can resolve out of order — a read
   * fired before a save can land after it. Any hash we've already seen is a
   * stale echo and must not be applied over newer local content; only
   * genuinely new hashes (another user or the agent editing) are real
   * external changes.
   */
  const knownVersionHashesRef = useRef(new Map<string, Set<string>>());
  const bufferLoadedListenersRef = useRef(
    new Set<(event: BufferLoadedEvent) => void>(),
  );
  const filesChangedListenersRef = useRef(new Set<() => void>());

  const rememberVersionHash = useCallback(
    (uri: string, versionHash: string | undefined) => {
      if (!versionHash) return;
      let hashes = knownVersionHashesRef.current.get(uri);
      if (!hashes) {
        hashes = new Set();
        knownVersionHashesRef.current.set(uri, hashes);
      }
      hashes.add(versionHash);
    },
    [],
  );

  const getProvider = useCallback(
    (providerKey: string) =>
      providersRef.current.find((provider) => provider.key === providerKey),
    [],
  );

  /**
   * Dirty tracking lives with model creation: models are created async after
   * their tab appears, so component-level subscriptions keyed on the tab list
   * would miss them. Listeners die with the model, so no manual disposal.
   */
  const dirtySubscribedModelsRef = useRef(new WeakSet<object>());
  const subscribeDirtyTracking = useCallback((uri: string) => {
    const entry = modelRegistry.get(uri);
    if (!entry || entry.model.isDisposed()) return;
    if (dirtySubscribedModelsRef.current.has(entry.model)) return;
    dirtySubscribedModelsRef.current.add(entry.model);
    entry.model.onDidChangeContent(() => {
      apiRef.current?.markDirty(uri, modelRegistry.isDirty(uri));
    });
  }, []);

  const loadBuffer = useCallback(
    async (uri: string) => {
      const { providerKey, path } = parseWorkbenchUri(uri);
      const provider = getProvider(providerKey);
      if (!provider) return;
      const existingMeta = stateRef.current.buffers[uri] as
        | BufferMeta
        | undefined;
      dispatch({
        type: "SET_BUFFER",
        meta: existingMeta
          ? { ...existingMeta, uri, loading: true }
          : {
              uri,
              loading: true,
              dirty: false,
              conflict: false,
              saving: false,
              readonly: false,
            },
      });
      try {
        const read = await provider.readFile(path);
        const language = read.language ?? languageForPath(path);
        modelRegistry.ensureModel(uri, read.content, language);
        subscribeDirtyTracking(uri);
        rememberVersionHash(uri, read.versionHash);
        const firstLoad = !loadedOnceRef.current.has(uri);
        loadedOnceRef.current.add(uri);
        dispatch({
          type: "SET_BUFFER",
          meta: {
            uri,
            loading: false,
            dirty: modelRegistry.isDirty(uri),
            conflict: false,
            saving: false,
            readonly: read.readonly ?? false,
            language,
            fileId: read.fileId,
            savedVersionHash: read.versionHash,
          },
        });
        const event: BufferLoadedEvent = {
          uri,
          providerKey,
          path,
          read,
          firstLoad,
        };
        for (const listener of bufferLoadedListenersRef.current) {
          try {
            listener(event);
          } catch {
            // Listener failures must not break buffer loading.
          }
        }
      } catch (error) {
        dispatch({
          type: "PATCH_BUFFER",
          uri,
          patch: {
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not read file" /* i18n-ignore */,
          },
        });
      }
    },
    [getProvider, rememberVersionHash, subscribeDirtyTracking],
  );

  const notifyFilesChanged = useCallback(() => {
    for (const listener of filesChangedListenersRef.current) {
      try {
        listener();
      } catch {
        // Ignore listener failures.
      }
    }
  }, []);

  const apiRef = useRef<WorkbenchApi | null>(null);
  if (!apiRef.current) {
    apiRef.current = {
      getState: () => stateRef.current,
      getProvider: (providerKey) => getProvider(providerKey),
      listProviders: () => providersRef.current,
      openFile: async (providerKey, path, options) => {
        const uri = workbenchUri(providerKey, path);
        const activate = options?.activate !== false;
        const preview = options?.preview ?? false;
        // A new preview tab replaces the current preview tab in place (see the
        // OPEN_TAB reducer); the replaced tab's buffer and model must be
        // released like any other close. Preview tabs pin on first edit, so a
        // replaced preview tab is never dirty.
        const alreadyOpen = stateRef.current.tabs.some(
          (tab) => tab.uri === uri,
        );
        const replacedPreview =
          preview && !alreadyOpen
            ? stateRef.current.tabs.find(
                (tab) => tab.preview && tab.uri !== uri,
              )
            : undefined;
        dispatch({
          type: "OPEN_TAB",
          tab: { uri, providerKey, path, preview },
          activate,
        });
        if (replacedPreview) {
          const replacedUri = replacedPreview.uri;
          dispatch({ type: "REMOVE_BUFFERS", uris: [replacedUri] });
          loadedOnceRef.current.delete(replacedUri);
          knownVersionHashesRef.current.delete(replacedUri);
          // Defer disposal past this commit so MonacoHost detaches the model
          // from the editor before it is destroyed.
          window.setTimeout(() => {
            if (!stateRef.current.tabs.some((tab) => tab.uri === replacedUri)) {
              modelRegistry.dispose(replacedUri);
            }
          }, 0);
        }
        if (
          !modelRegistry.has(uri) &&
          !stateRef.current.buffers[uri]?.loading
        ) {
          await loadBuffer(uri);
        }
        return uri;
      },
      setActive: (uri) => dispatch({ type: "SET_ACTIVE", uri }),
      pinTab: (uri) => dispatch({ type: "PIN_TAB", uri }),
      closeTab: (uri) => {
        const { tabs, mru, activeUri } = stateRef.current;
        const remaining = tabs.filter((tab) => tab.uri !== uri);
        const nextActive =
          activeUri === uri
            ? (mru.find(
                (entry) =>
                  entry !== uri && remaining.some((tab) => tab.uri === entry),
              ) ??
              remaining[remaining.length - 1]?.uri ??
              null)
            : activeUri;
        dispatch({ type: "CLOSE_TABS", uris: [uri], nextActive });
        dispatch({ type: "REMOVE_BUFFERS", uris: [uri] });
        loadedOnceRef.current.delete(uri);
        knownVersionHashesRef.current.delete(uri);
        modelRegistry.dispose(uri);
      },
      closeOthers: (uri) => {
        const closing = stateRef.current.tabs
          .map((tab) => tab.uri)
          .filter((entry) => entry !== uri);
        dispatch({ type: "CLOSE_TABS", uris: closing, nextActive: uri });
        dispatch({ type: "REMOVE_BUFFERS", uris: closing });
        for (const entry of closing) {
          loadedOnceRef.current.delete(entry);
          knownVersionHashesRef.current.delete(entry);
          modelRegistry.dispose(entry);
        }
      },
      closeSaved: () => {
        const { tabs, buffers, activeUri, mru } = stateRef.current;
        const closing = tabs
          .map((tab) => tab.uri)
          .filter((uri) => !buffers[uri]?.dirty);
        const remaining = tabs.filter((tab) => !closing.includes(tab.uri));
        const nextActive = closing.includes(activeUri ?? "")
          ? (mru.find((entry) => remaining.some((tab) => tab.uri === entry)) ??
            remaining[0]?.uri ??
            null)
          : activeUri;
        dispatch({ type: "CLOSE_TABS", uris: closing, nextActive });
        dispatch({ type: "REMOVE_BUFFERS", uris: closing });
        for (const entry of closing) {
          loadedOnceRef.current.delete(entry);
          knownVersionHashesRef.current.delete(entry);
          modelRegistry.dispose(entry);
        }
      },
      closeAll: () => {
        const closing = stateRef.current.tabs.map((tab) => tab.uri);
        dispatch({ type: "CLOSE_TABS", uris: closing, nextActive: null });
        dispatch({ type: "REMOVE_BUFFERS", uris: closing });
        for (const entry of closing) {
          loadedOnceRef.current.delete(entry);
          knownVersionHashesRef.current.delete(entry);
          modelRegistry.dispose(entry);
        }
      },
      reorderTabs: (fromIndex, toIndex) =>
        dispatch({ type: "REORDER_TABS", fromIndex, toIndex }),
      activateNextTab: (direction) => {
        const { tabs, activeUri } = stateRef.current;
        if (tabs.length === 0) return;
        const currentIndex = tabs.findIndex((tab) => tab.uri === activeUri);
        const nextIndex =
          (currentIndex + direction + tabs.length) % tabs.length;
        dispatch({ type: "SET_ACTIVE", uri: tabs[nextIndex].uri });
      },
      markDirty: (uri, dirty) => {
        const meta = stateRef.current.buffers[uri];
        if (!meta || meta.dirty === dirty) return;
        dispatch({ type: "PATCH_BUFFER", uri, patch: { dirty } });
        if (dirty) {
          const tab = stateRef.current.tabs.find((entry) => entry.uri === uri);
          if (tab?.preview) dispatch({ type: "PIN_TAB", uri });
        }
      },
      save: async (uriInput) => {
        const uri = uriInput ?? stateRef.current.activeUri;
        if (!uri) return;
        const meta = stateRef.current.buffers[uri];
        const entry = modelRegistry.get(uri);
        if (!meta || !entry || meta.saving || meta.readonly) return;
        if (!modelRegistry.isDirty(uri)) return;
        const { providerKey, path } = parseWorkbenchUri(uri);
        const provider = getProvider(providerKey);
        if (!provider || !provider.capabilities.write) return;
        const content = entry.model.getValue();
        const altVersionId = entry.model.getAlternativeVersionId();
        dispatch({ type: "PATCH_BUFFER", uri, patch: { saving: true } });
        try {
          const result = await provider.writeFile(
            path,
            content,
            meta.savedVersionHash,
          );
          rememberVersionHash(uri, result.versionHash);
          modelRegistry.markSaved(uri, altVersionId);
          dispatch({
            type: "PATCH_BUFFER",
            uri,
            patch: {
              saving: false,
              dirty: modelRegistry.isDirty(uri),
              conflict: false,
              savedVersionHash: result.versionHash ?? meta.savedVersionHash,
              lastSavedAt: Date.now(),
            },
          });
        } catch (error) {
          if (error instanceof WorkspaceStaleVersionError) {
            try {
              const latest = await provider.readFile(path);
              if (latest.content === content) {
                rememberVersionHash(uri, latest.versionHash);
                modelRegistry.markSaved(uri, altVersionId);
                dispatch({
                  type: "PATCH_BUFFER",
                  uri,
                  patch: {
                    saving: false,
                    dirty: modelRegistry.isDirty(uri),
                    conflict: false,
                    readonly: latest.readonly ?? meta.readonly,
                    language: latest.language ?? meta.language,
                    fileId: latest.fileId ?? meta.fileId,
                    savedVersionHash:
                      latest.versionHash ?? meta.savedVersionHash,
                    lastSavedAt: Date.now(),
                  },
                });
                return;
              }
            } catch {
              // Keep the original stale-version error; the user can reload
              // latest from the status bar without losing this buffer first.
            }
          }
          dispatch({
            type: "PATCH_BUFFER",
            uri,
            patch: {
              saving: false,
              conflict: error instanceof WorkspaceStaleVersionError,
            },
          });
          throw error;
        }
      },
      saveAll: async () => {
        const dirtyUris = stateRef.current.tabs
          .map((tab) => tab.uri)
          .filter((uri) => stateRef.current.buffers[uri]?.dirty);
        for (const uri of dirtyUris) {
          await apiRef.current!.save(uri);
        }
      },
      reloadBuffer: async (uri) => {
        await loadBuffer(uri);
      },
      applyExternalRead: (uri, read) => {
        const meta = stateRef.current.buffers[uri];
        if (!meta) return;
        if (read.versionHash && read.versionHash === meta.savedVersionHash) {
          return;
        }
        const entry = modelRegistry.get(uri);
        if (entry && !entry.model.isDisposed()) {
          if (entry.model.getValue() === read.content) {
            rememberVersionHash(uri, read.versionHash);
            modelRegistry.markSaved(uri, entry.model.getAlternativeVersionId());
            dispatch({
              type: "PATCH_BUFFER",
              uri,
              patch: {
                savedVersionHash: read.versionHash ?? meta.savedVersionHash,
                dirty: false,
                conflict: false,
                readonly: read.readonly ?? meta.readonly,
                language: read.language ?? meta.language,
                fileId: read.fileId ?? meta.fileId,
              },
            });
            return;
          }
        }
        // Stale echo: a poll that resolved out of order carries a hash this
        // client already loaded or saved. Never apply it over newer content.
        if (
          read.versionHash &&
          knownVersionHashesRef.current.get(uri)?.has(read.versionHash)
        ) {
          return;
        }
        if (modelRegistry.isDirty(uri)) {
          dispatch({ type: "PATCH_BUFFER", uri, patch: { conflict: true } });
          return;
        }
        rememberVersionHash(uri, read.versionHash);
        modelRegistry.applyExternalContent(uri, read.content);
        dispatch({
          type: "PATCH_BUFFER",
          uri,
          patch: {
            savedVersionHash: read.versionHash,
            dirty: false,
            conflict: false,
          },
        });
      },
      createFile: async (providerKey, path) => {
        const provider = getProvider(providerKey);
        if (!provider?.createFile) return;
        await provider.createFile(path, "");
        notifyFilesChanged();
        await apiRef.current!.openFile(providerKey, path, { preview: false });
      },
      renameFile: async (providerKey, path, nextPath) => {
        const provider = getProvider(providerKey);
        if (!provider?.renameFile) return;
        await provider.renameFile(path, nextPath);
        const uri = workbenchUri(providerKey, path);
        const nextUri = workbenchUri(providerKey, nextPath);
        if (stateRef.current.buffers[uri]) {
          const content = modelRegistry.getContent(uri) ?? "";
          const language = languageForPath(nextPath);
          modelRegistry.dispose(uri);
          modelRegistry.ensureModel(nextUri, content, language);
          subscribeDirtyTracking(nextUri);
          const knownHashes = knownVersionHashesRef.current.get(uri);
          if (knownHashes) {
            knownVersionHashesRef.current.delete(uri);
            knownVersionHashesRef.current.set(nextUri, knownHashes);
          }
          dispatch({ type: "RENAME_URI", uri, nextUri, nextPath });
        }
        notifyFilesChanged();
      },
      deleteFile: async (providerKey, path) => {
        const provider = getProvider(providerKey);
        if (!provider?.deleteFile) return;
        await provider.deleteFile(path);
        const uri = workbenchUri(providerKey, path);
        if (stateRef.current.tabs.some((tab) => tab.uri === uri)) {
          apiRef.current!.closeTab(uri);
        }
        notifyFilesChanged();
      },
      setSideView: (view) => dispatch({ type: "SET_SIDE_VIEW", view }),
      toggleSidebar: () =>
        dispatch({
          type: "SET_SIDEBAR_VISIBLE",
          visible: !stateRef.current.sidebarVisible,
        }),
      setSidebarWidth: (width) =>
        dispatch({ type: "SET_SIDEBAR_WIDTH", width }),
      refreshFileLists: () => notifyFilesChanged(),
      onBufferLoaded: (listener) => {
        bufferLoadedListenersRef.current.add(listener);
        return () => bufferLoadedListenersRef.current.delete(listener);
      },
      onFilesChanged: (listener) => {
        filesChangedListenersRef.current.add(listener);
        return () => filesChangedListenersRef.current.delete(listener);
      },
    };
  }

  useEffect(() => {
    return () => {
      modelRegistry.disposeAll();
    };
  }, []);

  const value = useMemo<WorkbenchContextValue>(
    () => ({ state, api: apiRef.current!, providers }),
    [state, providers],
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

/** Shared language inference for workbench buffers. */
export function languageForPath(path: string): string {
  if (/\.html?$/i.test(path)) return "html";
  if (/\.(css|scss|less)$/i.test(path)) return "css";
  if (/\.json$/i.test(path)) return "json";
  if (/\.tsx?$/i.test(path)) return "typescript";
  if (/\.(jsx?|mjs|cjs)$/i.test(path)) return "javascript";
  if (/\.(md|mdx)$/i.test(path)) return "markdown";
  if (/\.(yml|yaml)$/i.test(path)) return "yaml";
  if (/\.svg$/i.test(path)) return "xml";
  if (/\.(vue|svelte|astro)$/i.test(path)) return "html";
  return "plaintext";
}
