import { useState, useCallback } from "react";
import { APP_REGISTRY } from "@shared/app-registry";
import Sidebar from "./components/Sidebar.js";
import AppWebview from "./components/AppWebview.js";

export default function App() {
  // Start on Calendar (first non-placeholder app)
  const defaultApp =
    APP_REGISTRY.find((a) => !a.placeholder) ?? APP_REGISTRY[0];

  const [activeAppId, setActiveAppId] = useState(defaultApp.id);

  // Track which apps have been activated (to lazy-mount their webviews).
  // Once mounted, a webview is never unmounted — this preserves its full state
  // (login sessions, scroll position, in-progress forms, etc.) when switching tabs.
  const [mountedApps, setMountedApps] = useState<Set<string>>(
    new Set([defaultApp.id]),
  );

  const handleTabChange = useCallback((appId: string) => {
    setMountedApps((prev) => new Set([...prev, appId]));
    setActiveAppId(appId);
  }, []);

  return (
    <div className="shell">
      <Sidebar
        apps={APP_REGISTRY}
        activeAppId={activeAppId}
        onTabChange={handleTabChange}
      />
      <div className="content-area">
        {APP_REGISTRY.map((app) =>
          mountedApps.has(app.id) ? (
            <AppWebview
              key={app.id}
              app={app}
              isActive={app.id === activeAppId}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
