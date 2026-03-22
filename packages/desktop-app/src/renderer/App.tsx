import { useState, useCallback, useEffect, useRef } from "react";
import {
  APP_REGISTRY,
  type AppDefinition,
  type AppConfig,
  toAppDefinition,
} from "@shared/app-registry";
import Sidebar from "./components/Sidebar.js";
import TabBar from "./components/TabBar.js";
import AppWebview from "./components/AppWebview.js";
import AppSettings from "./components/AppSettings.js";

export interface Tab {
  id: string;
  appId: string;
  title: string;
}

let nextTabId = 1;

function createTab(app: AppDefinition | AppConfig): Tab {
  return {
    id: `tab-${nextTabId++}`,
    appId: app.id,
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
        // Fallback for dev without electron
        setApps(
          APP_REGISTRY.map((a) => ({
            ...a,
            url: `http://localhost:${a.devPort}`,
            isBuiltIn: true,
            enabled: true,
          })),
        );
      }
      setLoading(false);
    }
    load();
  }, []);

  const enabledApps = apps.filter((a) => a.enabled);
  const appDefs = enabledApps.map(toAppDefinition);

  const defaultApp = appDefs.find((a) => !a.placeholder) ?? appDefs[0];

  const [activeSidebarAppId, setActiveSidebarAppId] = useState("");
  const [appTabs, setAppTabs] = useState<Record<string, AppTabState>>({});

  // Initialize tabs when apps load
  useEffect(() => {
    if (enabledApps.length === 0) return;
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
    setActiveSidebarAppId((prev) => {
      if (prev && enabledApps.find((a) => a.id === prev)) return prev;
      const def =
        enabledApps.find((a) => !("placeholder" in a)) ?? enabledApps[0];
      return def?.id ?? "";
    });
  }, [enabledApps.map((a) => a.id).join(",")]);

  const closedTabsRef = useRef<{ tab: Tab; appId: string }[]>([]);

  const currentAppTabs = appTabs[activeSidebarAppId];

  const handleAppsChanged = useCallback((newApps: AppConfig[]) => {
    setApps(newApps);
  }, []);

  const handleSidebarTabChange = useCallback((appId: string) => {
    setActiveSidebarAppId(appId);
  }, []);

  const handleTabSelect = useCallback(
    (tabId: string) => {
      setAppTabs((prev) => ({
        ...prev,
        [activeSidebarAppId]: {
          ...prev[activeSidebarAppId],
          activeTabId: tabId,
        },
      }));
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
        const idx = prevAppState.tabs.findIndex((t) => t.id === tabId);
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
    setActiveSidebarAppId(entry.appId);
    setAppTabs((prev) => ({
      ...prev,
      [entry.appId]: {
        tabs: [...prev[entry.appId].tabs, entry.tab],
        activeTabId: entry.tab.id,
      },
    }));
  }, []);

  const handleNewTab = useCallback(() => {
    const app = enabledApps.find((a) => a.id === activeSidebarAppId);
    if (!app) return;
    const tab = createTab(app);
    setAppTabs((prev) => ({
      ...prev,
      [activeSidebarAppId]: {
        tabs: [...prev[activeSidebarAppId].tabs, tab],
        activeTabId: tab.id,
      },
    }));
  }, [activeSidebarAppId, enabledApps]);

  const handleShortcut = useCallback(
    (key: string, shiftKey: boolean) => {
      const k = key.toLowerCase();

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
        setActiveSidebarAppId((current) => {
          const idx = appDefs.findIndex((a) => a.id === current);
          const next =
            key === "]"
              ? (idx + 1) % appDefs.length
              : (idx - 1 + appDefs.length) % appDefs.length;
          return appDefs[next].id;
        });
      }
    },
    [handleNewTab, handleReopenTab, appDefs],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      handleShortcut(e.key, e.shiftKey);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleShortcut]);

  useEffect(() => {
    if (!window.electronAPI?.shortcuts?.onKeydown) return;
    return window.electronAPI.shortcuts.onKeydown(({ key, shiftKey }) => {
      handleShortcut(key, shiftKey);
    });
  }, [handleShortcut]);

  // Report the active app to main process so DevTools targets the right webview
  useEffect(() => {
    if (activeSidebarAppId && window.electronAPI?.setActiveApp) {
      window.electronAPI.setActiveApp(activeSidebarAppId);
    }
  }, [activeSidebarAppId]);

  const activeTabIdRef = useRef(currentAppTabs?.activeTabId ?? "");
  activeTabIdRef.current = currentAppTabs?.activeTabId ?? "";

  useEffect(() => {
    if (!window.electronAPI?.shortcuts?.onCloseTab) return;
    return window.electronAPI.shortcuts.onCloseTab(() => {
      if (activeTabIdRef.current) {
        handleTabClose(activeTabIdRef.current);
      }
    });
  }, [handleTabClose]);

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

  // Collect all mounted webviews across all enabled apps
  const allWebviews: {
    tab: Tab;
    app: AppConfig;
    appDef: AppDefinition;
    isActive: boolean;
  }[] = [];
  for (const app of enabledApps) {
    const state = appTabs[app.id];
    if (!state) continue;
    for (const tab of state.tabs) {
      allWebviews.push({
        tab,
        app,
        appDef: toAppDefinition(app),
        isActive: app.id === activeSidebarAppId && tab.id === state.activeTabId,
      });
    }
  }

  return (
    <div className="shell">
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
              app={appDef}
              appConfig={app}
              isActive={isActive}
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
    </div>
  );
}
