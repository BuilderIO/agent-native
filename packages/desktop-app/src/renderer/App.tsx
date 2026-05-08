import { useState, useCallback, useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import {
  APP_REGISTRY,
  DEFAULT_APPS,
  type AppDefinition,
  type AppConfig,
  toAppDefinition,
} from "@shared/app-registry";
import Sidebar from "./components/Sidebar.js";
import TabBar from "./components/TabBar.js";
import AppWebview, { type AppWebviewHandle } from "./components/AppWebview.js";
import AppSettings from "./components/AppSettings.js";
import UpdatePrompt from "./components/UpdatePrompt.js";

export interface Tab {
  id: string;
  appId: string;
  icon: string;
  title: string;
}

let nextTabId = 1;

function createTab(app: AppDefinition | AppConfig): Tab {
  return {
    id: `tab-${nextTabId++}`,
    appId: app.id,
    icon: app.icon,
    title: app.name,
  };
}

// Per-app tab state: appId → { tabs, activeTabId }
interface AppTabState {
  tabs: Tab[];
  activeTabId: string;
}

function initAppTabs(
  apps: (AppDefinition | AppConfig)[],
): Record<string, AppTabState> {
  const state: Record<string, AppTabState> = {};
  for (const app of apps) {
    const tab = createTab(app);
    state[app.id] = { tabs: [tab], activeTabId: tab.id };
  }
  return state;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

function isShellShortcut(e: KeyboardEvent): boolean {
  if (!e.metaKey && !e.ctrlKey) return false;

  const key = e.key.toLowerCase();
  if (e.altKey && (key === "arrowup" || key === "arrowdown")) return true;

  return (
    key === "f" ||
    key === "l" ||
    key === "r" ||
    key === "t" ||
    key === "[" ||
    key === "]" ||
    (key >= "1" && key <= "9")
  );
}

export default function App() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Load apps from persistent store
  useEffect(() => {
    async function load() {
      if (window.electronAPI?.appConfig) {
        const loaded = await window.electronAPI.appConfig.load();
        setApps(loaded);
      } else {
        // Fallback for dev without electron — use full config with production URLs
        setApps(DEFAULT_APPS);
      }
      setLoading(false);
    }
    load();
  }, []);

  const enabledApps = apps.filter((a) => a.enabled);
  const enabledAppIdsKey = enabledApps.map((a) => a.id).join(",");
  const rawAppDefs = enabledApps.map(toAppDefinition);
  // Keep this in sync with Sidebar's pinned-bottom order.
  const PINNED_BOTTOM_ORDER = ["dispatch", "starter"];
  const pinnedBottomDefs = PINNED_BOTTOM_ORDER.map((id) =>
    rawAppDefs.find((a) => a.id === id),
  ).filter((a): a is NonNullable<typeof a> => !!a);
  const mainDefs = rawAppDefs.filter(
    (a) => !PINNED_BOTTOM_ORDER.includes(a.id),
  );
  const appDefs = [...mainDefs, ...pinnedBottomDefs];

  const defaultApp = appDefs.find((a) => !a.placeholder) ?? appDefs[0];

  const [activeSidebarAppId, setActiveSidebarAppId] = useState("");
  const [appTabs, setAppTabs] = useState<Record<string, AppTabState>>({});
  const [mountedAppIds, setMountedAppIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Initialize tabs when apps load
  useEffect(() => {
    if (enabledApps.length === 0) return;
    const enabledIds = new Set(enabledApps.map((app) => app.id));
    setAppTabs((prev) => {
      // Only init tabs for apps that don't have tabs yet
      const next = { ...prev };
      for (const app of enabledApps) {
        if (!next[app.id]) {
          const tab = createTab(app);
          next[app.id] = { tabs: [tab], activeTabId: tab.id };
        }
      }
      return next;
    });
    setMountedAppIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const appId of prev) {
        if (enabledIds.has(appId)) next.add(appId);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setActiveSidebarAppId((prev) => {
      if (prev && enabledApps.find((a) => a.id === prev)) return prev;
      // Pick from `appDefs` (AppDefinition) so the placeholder check works —
      // `enabledApps` is AppConfig[] and has no `placeholder` field, so the
      // old `"placeholder" in a` check was a no-op.
      const def = appDefs.find((a) => !a.placeholder) ?? appDefs[0];
      return def?.id ?? "";
    });
  }, [enabledAppIdsKey]);

  useEffect(() => {
    if (!activeSidebarAppId) return;
    setMountedAppIds((prev) => {
      if (prev.has(activeSidebarAppId)) return prev;
      const next = new Set(prev);
      next.add(activeSidebarAppId);
      return next;
    });
  }, [activeSidebarAppId]);

  const closedTabsRef = useRef<{ tab: Tab; appId: string }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const webviewRefs = useRef(new Map<string, AppWebviewHandle>());

  const currentAppTabs = appTabs[activeSidebarAppId];
  const activeTabId = currentAppTabs?.activeTabId ?? "";
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const handleAppsChanged = useCallback((newApps: AppConfig[]) => {
    setApps(newApps);
  }, []);

  const handleSidebarTabChange = useCallback((appId: string) => {
    setActiveSidebarAppId(appId);
  }, []);

  const handleTabSelect = useCallback(
    (tabId: string) => {
      setAppTabs((prev) => {
        const appState = prev[activeSidebarAppId];
        if (!appState?.tabs.some((tab) => tab.id === tabId)) return prev;

        return {
          ...prev,
          [activeSidebarAppId]: {
            ...appState,
            activeTabId: tabId,
          },
        };
      });
    },
    [activeSidebarAppId],
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      const appState = appTabs[activeSidebarAppId];
      const closedTab = appState?.tabs.find((t) => t.id === tabId);
      if (closedTab) {
        closedTabsRef.current.push({
          tab: closedTab,
          appId: activeSidebarAppId,
        });
      }

      setAppTabs((prev) => {
        const prevAppState = prev[activeSidebarAppId];
        if (!prevAppState) return prev;

        const idx = prevAppState.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;

        const next = prevAppState.tabs.filter((t) => t.id !== tabId);

        if (next.length === 0) {
          const app = enabledApps.find((a) => a.id === activeSidebarAppId);
          if (!app) return prev;
          const tab = createTab(app);
          return {
            ...prev,
            [activeSidebarAppId]: { tabs: [tab], activeTabId: tab.id },
          };
        }

        let newActiveId = prevAppState.activeTabId;
        if (tabId === prevAppState.activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          newActiveId = next[newIdx].id;
        }

        return {
          ...prev,
          [activeSidebarAppId]: { tabs: next, activeTabId: newActiveId },
        };
      });
    },
    [activeSidebarAppId, appTabs, enabledApps],
  );

  const handleReopenTab = useCallback(() => {
    const entry = closedTabsRef.current.pop();
    if (!entry) return;
    if (!enabledApps.some((app) => app.id === entry.appId)) return;

    setActiveSidebarAppId(entry.appId);
    setAppTabs((prev) => {
      const appState = prev[entry.appId];
      if (!appState) return prev;

      return {
        ...prev,
        [entry.appId]: {
          tabs: [...appState.tabs, entry.tab],
          activeTabId: entry.tab.id,
        },
      };
    });
  }, [enabledApps]);

  const handleNewTab = useCallback(() => {
    const app = enabledApps.find((a) => a.id === activeSidebarAppId);
    if (!app) return;
    const tab = createTab(app);
    setAppTabs((prev) => {
      const appState = prev[activeSidebarAppId];
      if (!appState) return prev;

      return {
        ...prev,
        [activeSidebarAppId]: {
          tabs: [...appState.tabs, tab],
          activeTabId: tab.id,
        },
      };
    });
  }, [activeSidebarAppId, enabledApps]);

  const handleCopyCurrentUrl = useCallback(async () => {
    const currentUrl = webviewRefs.current
      .get(activeTabIdRef.current)
      ?.getUrl();
    if (!currentUrl) return;

    try {
      if (window.electronAPI?.clipboard?.writeText) {
        const copied = await window.electronAPI.clipboard.writeText(currentUrl);
        if (!copied) return;
      } else {
        await navigator.clipboard.writeText(currentUrl);
      }
      toast("URL copied", {
        id: "url-copied",
        duration: 1600,
      });
    } catch {
      // Clipboard permissions vary in browser-only dev mode; the Electron
      // bridge is used in the packaged app.
    }
  }, []);

  const handleShortcut = useCallback(
    (key: string, shiftKey: boolean, altKey: boolean = false) => {
      const k = key.toLowerCase();

      // Cmd+Option+Up/Down — previous/next app
      if (altKey && (k === "arrowup" || k === "arrowdown")) {
        setActiveSidebarAppId((current) => {
          const idx = appDefs.findIndex((a) => a.id === current);
          const next =
            k === "arrowdown"
              ? (idx + 1) % appDefs.length
              : (idx - 1 + appDefs.length) % appDefs.length;
          return appDefs[next].id;
        });
        return;
      }

      if (k === "f") {
        setFindOpen(true);
        setTimeout(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        }, 0);
        return;
      }

      if (k === "l") {
        void handleCopyCurrentUrl();
        return;
      }

      if (k === "r") {
        setRefreshKey((n) => n + 1);
        return;
      }

      if (k === "t") {
        if (shiftKey) handleReopenTab();
        else handleNewTab();
        return;
      }

      const digit = parseInt(key, 10);
      if (digit >= 1 && digit <= 9) {
        if (digit - 1 < appDefs.length) {
          setActiveSidebarAppId(appDefs[digit - 1].id);
        }
        return;
      }

      if (key === "[" || key === "]") {
        if (shiftKey) {
          setActiveSidebarAppId((current) => {
            const idx = appDefs.findIndex((a) => a.id === current);
            const next =
              key === "]"
                ? (idx + 1) % appDefs.length
                : (idx - 1 + appDefs.length) % appDefs.length;
            return appDefs[next].id;
          });
        } else {
          const ref = webviewRefs.current.get(activeTabIdRef.current);
          if (key === "[") ref?.goBack();
          else ref?.goForward();
        }
      }
    },
    [handleCopyCurrentUrl, handleNewTab, handleReopenTab, appDefs],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isShellShortcut(e) || isEditableTarget(e.target)) return;
      e.preventDefault();
      handleShortcut(e.key, e.shiftKey, e.altKey);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleShortcut]);

  useEffect(() => {
    if (!window.electronAPI?.shortcuts?.onKeydown) return;
    return window.electronAPI.shortcuts.onKeydown(
      ({ key, shiftKey, altKey }) => {
        handleShortcut(key, shiftKey, altKey);
      },
    );
  }, [handleShortcut]);

  // Report the active app to main process so DevTools targets the right webview
  useEffect(() => {
    if (activeSidebarAppId && window.electronAPI?.setActiveApp) {
      window.electronAPI.setActiveApp(activeSidebarAppId);
    }
  }, [activeSidebarAppId]);

  useEffect(() => {
    if (!window.electronAPI?.shortcuts?.onCloseTab) return;
    return window.electronAPI.shortcuts.onCloseTab(() => {
      if (activeTabIdRef.current) {
        handleTabClose(activeTabIdRef.current);
      }
    });
  }, [handleTabClose]);

  const runFind = useCallback(
    (query: string, options?: { findNext?: boolean; forward?: boolean }) => {
      const ref = webviewRefs.current.get(activeTabId);
      if (!ref || !query.trim()) return;
      ref.findInPage(query, options);
    },
    [activeTabId],
  );

  const closeFind = useCallback(() => {
    if (activeTabId) {
      webviewRefs.current.get(activeTabId)?.stopFindInPage("clearSelection");
    }
    setFindOpen(false);
    setFindQuery("");
  }, [activeTabId]);

  useEffect(() => {
    if (!findOpen || !findQuery.trim()) return;
    runFind(findQuery, { forward: true });
  }, [activeTabId, findOpen, findQuery, runFind]);

  if (loading) {
    return (
      <div
        className="shell"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <p style={{ color: "#666" }}>Loading...</p>
      </div>
    );
  }

  // Keep app webviews warm once visited so switching apps feels like browser
  // tabs: the guest page remains alive offscreen and keeps its runtime state.
  const allWebviews: {
    tab: Tab;
    app: AppConfig;
    appDef: AppDefinition;
    isActive: boolean;
  }[] = [];
  for (const app of enabledApps) {
    if (app.id !== activeSidebarAppId && !mountedAppIds.has(app.id)) {
      continue;
    }

    const appState = appTabs[app.id];
    if (!appState) continue;

    for (const tab of appState.tabs) {
      allWebviews.push({
        tab,
        app,
        appDef: toAppDefinition(app),
        isActive:
          app.id === activeSidebarAppId && tab.id === appState.activeTabId,
      });
    }
  }

  return (
    <div className="shell">
      {findOpen && (
        <div className="find-overlay">
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runFind(findQuery, {
                  findNext: true,
                  forward: !e.shiftKey,
                });
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
            placeholder="Find in page"
            className="find-input"
          />
          <button
            type="button"
            tabIndex={-1}
            className="find-button"
            onClick={() =>
              runFind(findQuery, { findNext: true, forward: false })
            }
          >
            Prev
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="find-button"
            onClick={() =>
              runFind(findQuery, { findNext: true, forward: true })
            }
          >
            Next
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="find-button find-button--close"
            onClick={closeFind}
          >
            Done
          </button>
        </div>
      )}
      <TabBar
        tabs={currentAppTabs?.tabs ?? []}
        activeTabId={currentAppTabs?.activeTabId ?? ""}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
        onNewTab={handleNewTab}
      />
      <div className="shell-body">
        <Sidebar
          apps={appDefs}
          activeAppId={activeSidebarAppId}
          onTabChange={handleSidebarTabChange}
          onSettingsClick={() => setShowSettings(true)}
        />
        <div className="content-area">
          {allWebviews.map(({ tab, app, appDef, isActive }) => (
            <AppWebview
              key={tab.id}
              ref={(instance) => {
                if (instance) webviewRefs.current.set(tab.id, instance);
                else webviewRefs.current.delete(tab.id);
              }}
              app={appDef}
              appConfig={app}
              isActive={isActive}
              refreshKey={isActive ? refreshKey : 0}
              onAppsChanged={handleAppsChanged}
            />
          ))}
        </div>
      </div>

      {showSettings && (
        <AppSettings
          apps={apps}
          onClose={() => setShowSettings(false)}
          onAppsChanged={handleAppsChanged}
        />
      )}

      <UpdatePrompt />
      <Toaster
        className="shell-snackbar-toaster"
        theme="dark"
        position="bottom-center"
        offset={20}
        closeButton
        visibleToasts={1}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: "shell-snackbar",
            title: "shell-snackbar-title",
          },
        }}
      />
    </div>
  );
}
