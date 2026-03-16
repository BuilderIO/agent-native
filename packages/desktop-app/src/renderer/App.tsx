import { useState, useCallback, useEffect, useRef } from "react";
import { APP_REGISTRY, type AppDefinition } from "@shared/app-registry";
import Sidebar from "./components/Sidebar.js";
import TabBar from "./components/TabBar.js";
import AppWebview from "./components/AppWebview.js";

export interface Tab {
  id: string;
  appId: string;
  title: string;
}

let nextTabId = 1;

function createTab(app: AppDefinition): Tab {
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

function initAppTabs(): Record<string, AppTabState> {
  const state: Record<string, AppTabState> = {};
  for (const app of APP_REGISTRY) {
    const tab = createTab(app);
    state[app.id] = { tabs: [tab], activeTabId: tab.id };
  }
  return state;
}

export default function App() {
  const defaultApp =
    APP_REGISTRY.find((a) => !a.placeholder) ?? APP_REGISTRY[0];

  const [activeSidebarAppId, setActiveSidebarAppId] = useState(defaultApp.id);
  const [appTabs, setAppTabs] =
    useState<Record<string, AppTabState>>(initAppTabs);

  const closedTabsRef = useRef<{ tab: Tab; appId: string }[]>([]);

  const currentAppTabs = appTabs[activeSidebarAppId];

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
      setAppTabs((prev) => {
        const appState = prev[activeSidebarAppId];
        const closedTab = appState.tabs.find((t) => t.id === tabId);
        if (closedTab) {
          closedTabsRef.current.push({ tab: closedTab, appId: activeSidebarAppId });
        }

        const idx = appState.tabs.findIndex((t) => t.id === tabId);
        const next = appState.tabs.filter((t) => t.id !== tabId);

        if (next.length === 0) {
          const app = APP_REGISTRY.find((a) => a.id === activeSidebarAppId)!;
          const tab = createTab(app);
          return {
            ...prev,
            [activeSidebarAppId]: { tabs: [tab], activeTabId: tab.id },
          };
        }

        let newActiveId = appState.activeTabId;
        if (tabId === appState.activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          newActiveId = next[newIdx].id;
        }

        return {
          ...prev,
          [activeSidebarAppId]: { tabs: next, activeTabId: newActiveId },
        };
      });
    },
    [activeSidebarAppId],
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
    const app = APP_REGISTRY.find((a) => a.id === activeSidebarAppId);
    if (!app) return;
    const tab = createTab(app);
    setAppTabs((prev) => ({
      ...prev,
      [activeSidebarAppId]: {
        tabs: [...prev[activeSidebarAppId].tabs, tab],
        activeTabId: tab.id,
      },
    }));
  }, [activeSidebarAppId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      // Cmd+T — new tab, Cmd+Shift+T — reopen closed tab
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (e.shiftKey) {
          handleReopenTab();
        } else {
          handleNewTab();
        }
        return;
      }

      // Cmd+1 through Cmd+9
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 9) {
        const idx = digit - 1;
        if (idx < APP_REGISTRY.length) {
          e.preventDefault();
          setActiveSidebarAppId(APP_REGISTRY[idx].id);
        }
        return;
      }

      // Cmd+[ / Cmd+] to go prev/next app
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        setActiveSidebarAppId((current) => {
          const idx = APP_REGISTRY.findIndex((a) => a.id === current);
          const next =
            e.key === "]"
              ? (idx + 1) % APP_REGISTRY.length
              : (idx - 1 + APP_REGISTRY.length) % APP_REGISTRY.length;
          return APP_REGISTRY[next].id;
        });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewTab, handleReopenTab]);

  // Cmd+W — close active tab (intercepted by main process, forwarded via IPC)
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

  // Collect all mounted webviews across all apps
  const allWebviews: { tab: Tab; app: AppDefinition; isActive: boolean }[] = [];
  for (const app of APP_REGISTRY) {
    const state = appTabs[app.id];
    if (!state) continue;
    for (const tab of state.tabs) {
      allWebviews.push({
        tab,
        app,
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
          apps={APP_REGISTRY}
          activeAppId={activeSidebarAppId}
          onTabChange={handleSidebarTabChange}
        />
        <div className="content-area">
          {allWebviews.map(({ tab, app, isActive }) => (
            <AppWebview key={tab.id} app={app} isActive={isActive} />
          ))}
        </div>
      </div>
    </div>
  );
}
