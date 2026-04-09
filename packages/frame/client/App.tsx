/**
 * Local Dev Frame — App layout
 *
 * The sidebar always looks the same as the in-app agent panel: Chat | CLI | Files.
 * A toggle in the settings cog switches between Dev and Prod mode:
 * - Dev: frame renders its own chat/CLI in the sidebar (code editing agent)
 * - Prod: frame sidebar disappears, app's own agent sidebar shows inside iframe
 *
 * When collapsed in dev mode, the sidebar is 100% gone.
 */

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";

// Lazy-load heavy components
const MultiTabAssistantChat = lazy(() =>
  import("@agent-native/core/client").then((m) => ({
    default: m.MultiTabAssistantChat,
  })),
);

const AgentTerminal = lazy(() =>
  import("@agent-native/core/client").then((m) => ({
    default: m.AgentTerminal,
  })),
);

// Import the AgentPanel directly — it provides the full Chat/CLI/Files UI
const AgentPanel = lazy(() =>
  import("@agent-native/core/client").then((m) => ({
    default: m.AgentPanel,
  })),
);

type FrameMode = "dev" | "prod";

const SIDEBAR_WIDTH_KEY = "frame-sidebar-width";
const FRAME_MODE_KEY = "frame-mode";
const SIDEBAR_OPEN_KEY = "frame-sidebar-open";

function getAppId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("app") || "mail";
}

function getAppDevUrl(appId: string): string {
  const app = DEFAULT_APPS.find((a) => a.id === appId);
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  const port = app?.devPort || 8080;
  return `http://${host}:${port}`;
}

export function App() {
  const [appId] = useState(getAppId);
  const [frameMode, setFrameMode] = useState<FrameMode>(() => {
    try {
      const saved = localStorage.getItem(FRAME_MODE_KEY);
      if (saved === "dev" || saved === "prod") return saved;
    } catch {}
    return "dev";
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (saved !== null) return saved === "true";
    } catch {}
    return true;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) return Math.max(280, Math.min(700, parseInt(saved, 10)));
    } catch {}
    return 380;
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const appUrl = getAppDevUrl(appId);
  const app = DEFAULT_APPS.find((a) => a.id === appId);

  // Persist state
  useEffect(() => {
    try {
      localStorage.setItem(FRAME_MODE_KEY, frameMode);
    } catch {}
  }, [frameMode]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen));
    } catch {}
  }, [sidebarOpen]);

  // Show frame sidebar only in dev mode when open
  const showFrameSidebar = frameMode === "dev" && sidebarOpen;

  // Notify iframe of sidebar state
  function notifyIframe(mode: FrameMode, width: number, open: boolean) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "builder.sidebarMode",
        data: {
          mode: mode === "dev" ? "code" : "app",
          width,
          open,
        },
      },
      "*",
    );
  }

  // Send frame origin + initial state to iframe on load.
  // Retry a few times to handle slow mounts and HMR reloads.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function onLoad() {
      iframe!.contentWindow?.postMessage(
        { type: "builder.frameOrigin", origin: window.location.origin },
        "*",
      );
      const delays = [200, 500, 1500];
      const timers = delays.map((ms) =>
        setTimeout(
          () => notifyIframe(frameMode, sidebarWidth, sidebarOpen),
          ms,
        ),
      );
      return timers;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    function handleLoad() {
      timers = onLoad() || [];
    }
    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
      timers.forEach(clearTimeout);
    };
  }, []);

  // When mode/open/width changes, notify iframe
  useEffect(() => {
    notifyIframe(frameMode, sidebarWidth, sidebarOpen);
  }, [frameMode, sidebarWidth, sidebarOpen]);

  // Listen for dev mode toggle from AgentPanel settings cog
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.isDevMode === false) {
        setFrameMode("prod");
      } else if (detail?.isDevMode === true) {
        setFrameMode("dev");
      }
    }
    window.addEventListener("agent-panel:dev-mode-change", handler);
    return () =>
      window.removeEventListener("agent-panel:dev-mode-change", handler);
  }, []);

  // Listen for messages from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data?.type) return;
      if (event.data.type === "builder.toggleSidebar") {
        const forceOpen = event.data.data?.open;
        if (forceOpen === true) {
          setSidebarOpen(true);
        } else {
          setSidebarOpen((prev) => !prev);
        }
        return;
      }
      if (event.data.type === "builder.devModeChange") {
        const isDev = event.data.data?.isDevMode;
        if (isDev === true) {
          setFrameMode("dev");
          setSidebarOpen(true);
        } else if (isDev === false) {
          setFrameMode("prod");
        }
        return;
      }
      if (event.data.type === "builder.getUserInfo") {
        event.source?.postMessage(
          {
            type: "builder.userInfo",
            data: { name: "Developer", email: "local@localhost" },
          },
          { targetOrigin: event.origin },
        );
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Resize — use state so we can show an overlay on the iframe during drag
  const [isDragging, setIsDragging] = useState(false);
  const lastX = useRef(0);

  useEffect(() => {
    if (!isDragging) return;
    function onMouseMove(e: MouseEvent) {
      const delta = lastX.current - e.clientX;
      lastX.current = e.clientX;
      setSidebarWidth((prev) => {
        const next = Math.max(280, Math.min(700, prev + delta));
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
        } catch {}
        return next;
      });
    }
    function onMouseUp() {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{
        background: "hsl(var(--background))",
        color: "hsl(var(--foreground))",
      }}
    >
      {/* App iframe — takes all remaining space */}
      <div className="flex-1 min-w-0 relative">
        <iframe
          ref={iframeRef}
          src={appUrl}
          className="w-full h-full border-none"
          title={app?.name || "App"}
        />
        {/* Overlay during drag to prevent iframe from capturing mouse events */}
        {isDragging && (
          <div className="absolute inset-0" style={{ cursor: "col-resize" }} />
        )}
      </div>

      {/* Dev mode sidebar — looks identical to the in-app agent panel */}
      {showFrameSidebar && (
        <>
          <div
            className="shrink-0 cursor-col-resize relative"
            style={{ width: 1, background: "hsl(var(--border))", zIndex: 50 }}
            onMouseDown={startResize}
          >
            {/* Invisible wider hit area for easier dragging */}
            <div
              className="absolute inset-y-0 cursor-col-resize"
              style={{ left: -4, right: -4 }}
              onMouseDown={startResize}
            />
          </div>
          <div
            className="flex flex-col shrink-0 overflow-hidden"
            style={{ width: sidebarWidth, maxHeight: "100vh" }}
          >
            <Suspense
              fallback={
                <div
                  className="flex items-center justify-center h-full text-sm"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Loading...
                </div>
              }
            >
              <AgentPanel
                emptyStateText={`Ask me anything about ${app?.name || "your app"}`}
                suggestions={[
                  "What does this app do?",
                  "Show me the current screen",
                  "Add a new feature",
                ]}
                onCollapse={() => setSidebarOpen(false)}
                devAppUrl={appUrl}
                storageKey={appId}
              />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
}
