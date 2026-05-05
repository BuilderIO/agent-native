/**
 * Local Dev Frame — App layout
 *
 * The sidebar always looks the same as the in-app agent panel: Chat | CLI | Workspace.
 * A toggle in the settings cog switches between Dev and Prod mode:
 * - Dev: frame renders its own chat/CLI in the sidebar (code editing agent)
 * - Prod: frame sidebar disappears, app's own agent sidebar shows inside iframe
 *
 * When collapsed in dev mode, the sidebar is 100% gone.
 */

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { TEMPLATES, getTemplate } from "@agent-native/shared-app-config";
import { IconAppWindow, IconX } from "@tabler/icons-react";

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

// Import the AgentPanel directly — it provides the full Chat/CLI/Workspace UI
const AgentPanel = lazy(() =>
  import("@agent-native/core/client").then((m) => ({
    default: m.AgentPanel,
  })),
);

type FrameMode = "dev" | "prod";

const SIDEBAR_WIDTH_KEY = "frame-sidebar-width";
const FRAME_MODE_KEY = "frame-mode";
const SIDEBAR_OPEN_KEY = "frame-sidebar-open";
const SIDEBAR_FULLSCREEN_KEY = "frame-sidebar-fullscreen";
const DESKTOP_APP_NUDGE_DISMISSED_KEY = "frame.desktop-app-nudge.dismissed";

function getAppId(): string {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get("app") || "mail";
  // Set the routing cookie synchronously so the frame proxy routes
  // `/_agent-native/**` to the correct app backend on the very first
  // request — including fetches kicked off by child effects (which run
  // before parent effects in React, so a useEffect here would be too late).
  // Max-Age ensures a fresh partition or reload doesn't see a stale value
  // from a different app.
  if (typeof document !== "undefined") {
    document.cookie = `frame_active_app=${appId}; path=/; SameSite=Lax; Max-Age=31536000`;
  }
  return appId;
}

function getAppDevUrl(appId: string): string {
  const app = getTemplate(appId);
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  const port = app?.devPort || 8080;
  return `http://${host}:${port}`;
}

function isAgentNativeDesktop() {
  if (typeof navigator === "undefined") return false;
  return /AgentNativeDesktop/i.test(navigator.userAgent);
}

function DesktopAppNudge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isAgentNativeDesktop()) return;
    try {
      if (localStorage.getItem(DESKTOP_APP_NUDGE_DISMISSED_KEY) === "1") {
        return;
      }
    } catch {}
    setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DESKTOP_APP_NUDGE_DISMISSED_KEY, "1");
    } catch {}
  }

  if (!visible) return null;

  return (
    <div className="mx-2 my-1.5 rounded-md border border-border/70 bg-muted/35 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
      <div className="flex items-start gap-2">
        <IconAppWindow className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
        <p className="min-w-0 flex-1">
          <span className="font-medium text-foreground">
            Using local dev agents?
          </span>{" "}
          The desktop app keeps this chat together while your app reloads.{" "}
          <a
            href="https://agent-native.com/download"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Download
          </a>
        </p>
        <button
          type="button"
          onClick={dismiss}
          title="Dismiss desktop app tip"
          aria-label="Dismiss desktop app tip"
          className="-mr-1 -mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
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
  const [sidebarFullscreen, setSidebarFullscreen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_FULLSCREEN_KEY) === "true";
    } catch {}
    return false;
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const appUrl = getAppDevUrl(appId);
  const app = getTemplate(appId);

  // (The `frame_active_app` cookie is set synchronously by getAppId() on
  // first render, before any child effect can fetch /_agent-native/**.)

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
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_FULLSCREEN_KEY, String(sidebarFullscreen));
    } catch {}
  }, [sidebarFullscreen]);

  const [isPresentationMode, setIsPresentationMode] = useState(false);

  // Show frame sidebar only in dev mode when open, and not during presentation
  const showFrameSidebar =
    frameMode === "dev" && sidebarOpen && !isPresentationMode;

  // Notify iframe of sidebar state
  function notifyIframe(mode: FrameMode, width: number, open: boolean) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "agentNative.sidebarMode",
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
        { type: "agentNative.frameOrigin", origin: window.location.origin },
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
      if (event.data.type === "agentNative.toggleSidebar") {
        const forceOpen = event.data.data?.open;
        if (forceOpen === true) {
          setSidebarOpen(true);
        } else {
          setSidebarOpen((prev) => !prev);
        }
        return;
      }
      if (event.data.type === "agentNative.devModeChange") {
        const isDev = event.data.data?.isDevMode;
        if (isDev === true) {
          setFrameMode("dev");
          setSidebarOpen(true);
        } else if (isDev === false) {
          setFrameMode("prod");
        }
        return;
      }
      if (event.data.type === "agentNative.getUserInfo") {
        event.source?.postMessage(
          {
            type: "agentNative.userInfo",
            // guard:allow-localhost-fallback — Frame is a dev-only iframe wrapper that identifies itself to the Builder editor as the framework's dev-mode user; this is the dev identity, not a session-pooling fallback
            data: { name: "Developer", email: "local@localhost" },
          },
          { targetOrigin: event.origin },
        );
        return;
      }
      // Relay submitChat from the iframe — MultiTabAssistantChat rejects
      // cross-origin messages, so re-dispatch same-origin so it accepts it.
      // Only relay from known app dev-server origins to prevent arbitrary
      // cross-origin pages from injecting agent messages.
      if (event.data.type === "agentNative.presentationMode") {
        setIsPresentationMode(event.data.data?.active === true);
        return;
      }
      if (event.data.type === "agentNative.submitChat") {
        const host = window.location.hostname || "localhost";
        const allowedOrigins = new Set(
          TEMPLATES.flatMap((a) => [
            `http://localhost:${a.devPort || 8080}`,
            `http://${host}:${a.devPort || 8080}`,
          ]),
        );
        if (allowedOrigins.has(event.origin)) {
          window.postMessage(event.data, window.location.origin);
        }
        return;
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
      {/* App iframe — takes all remaining space. Hidden when sidebar is fullscreen. */}
      <div
        className="flex-1 min-w-0 relative"
        style={
          showFrameSidebar && sidebarFullscreen
            ? { display: "none" }
            : undefined
        }
      >
        <iframe
          ref={iframeRef}
          src={appUrl}
          className="w-full h-full border-none"
          title={app?.label || "App"}
          allow="fullscreen"
        />
        {/* Overlay during drag to prevent iframe from capturing mouse events */}
        {isDragging && (
          <div className="absolute inset-0" style={{ cursor: "col-resize" }} />
        )}
      </div>

      {/* Dev mode sidebar — looks identical to the in-app agent panel */}
      {showFrameSidebar && (
        <>
          {!sidebarFullscreen && (
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
          )}
          <div
            className="flex flex-col shrink-0 overflow-hidden"
            style={{
              width: sidebarFullscreen ? "100%" : sidebarWidth,
              flex: sidebarFullscreen ? 1 : undefined,
              maxHeight: "100vh",
            }}
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
                emptyStateText={`Ask me anything about ${app?.label || "your app"}`}
                suggestions={[
                  "What does this app do?",
                  "Show me the current screen",
                  "Add a new feature",
                ]}
                onCollapse={() => setSidebarOpen(false)}
                isFullscreen={sidebarFullscreen}
                onToggleFullscreen={() => setSidebarFullscreen((prev) => !prev)}
                devAppUrl={appUrl}
                storageKey={appId}
                chatNotice={<DesktopAppNudge />}
              />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
}
