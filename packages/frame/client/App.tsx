/**
 * Local Dev Frame — App layout
 *
 * The sidebar always looks the same as the in-app agent panel: Chat | CLI | Workspace.
 * A toggle in the settings cog switches between Dev and Prod mode:
 * - Dev: frame renders its own sidebar; Chat uses code-agent modes only with local code access
 * - Prod: frame sidebar disappears, app's own agent sidebar shows inside iframe
 *
 * When collapsed in dev mode, the sidebar is 100% gone.
 */

import {
  TEMPLATES,
  getTemplate,
  getTemplateGatewayAppUrl,
  getTemplateGatewayUrl,
} from "@agent-native/shared-app-config";
import {
  type CSSProperties,
  useState,
  useEffect,
  useRef,
  lazy,
  Suspense,
} from "react";

// Lazy-load the AgentPanel; it provides the full Chat/CLI/Workspace UI.
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
const SIDEBAR_STATE_CHANGE_EVENT = "agent-panel:state-change";
const APP_IFRAME_ALLOW = "camera; microphone; display-capture; fullscreen";
const OPEN_DESKTOP_URL = "agentnative://open";
const DOWNLOAD_DESKTOP_URL = "https://www.agent-native.com/download";
const SIDEBAR_ANIMATION_MS = 260;

function getAppId(): string {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get("app") || "mail";
  const customDevUrl = normalizeCustomDevUrl(params.get("devUrl"));
  // Set the routing cookie synchronously so the frame proxy routes
  // `/_agent-native/**` to the correct app backend on the very first
  // request — including fetches kicked off by child effects (which run
  // before parent effects in React, so a useEffect here would be too late).
  // Max-Age ensures a fresh partition or reload doesn't see a stale value
  // from a different app.
  if (typeof document !== "undefined") {
    document.cookie = `frame_active_app=${appId}; path=/; SameSite=Lax; Max-Age=31536000`;
    if (customDevUrl) {
      document.cookie = `frame_active_dev_url=${encodeURIComponent(customDevUrl)}; path=/; SameSite=Lax; Max-Age=31536000`;
    } else {
      document.cookie = "frame_active_dev_url=; path=/; Max-Age=0";
    }
  }
  return appId;
}

function normalizeCustomDevUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getAppDevUrl(appId: string): string {
  const params = new URLSearchParams(window.location.search);
  const customDevUrl = normalizeCustomDevUrl(params.get("devUrl"));
  if (customDevUrl) return customDevUrl;

  const gatewayUrl = getTemplateGatewayAppUrl(appId);
  if (gatewayUrl) return gatewayUrl;
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

function useAgentNativeDesktop() {
  const [isDesktop, setIsDesktop] = useState(isAgentNativeDesktop);

  useEffect(() => {
    setIsDesktop(isAgentNativeDesktop());
  }, []);

  return isDesktop;
}

function isAgentSidebarToggleShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "\\" || event.code === "Backslash")
  );
}

function getVisibleSidebarOpen(
  mode: FrameMode,
  open: boolean,
  presentationMode: boolean,
) {
  return mode === "dev" ? open && !presentationMode : open;
}

function dispatchFrameSidebarStateChange(open: boolean, mode: FrameMode) {
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_STATE_CHANGE_EVENT, {
      detail: {
        open,
        source: "frame",
        mode: mode === "dev" ? "code" : "app",
      },
    }),
  );
}

export function App() {
  const [appId] = useState(getAppId);
  const isDesktop = useAgentNativeDesktop();
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
  const customAppOrigin = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const customDevUrl = normalizeCustomDevUrl(params.get("devUrl"));
      return customDevUrl ? new URL(customDevUrl).origin : null;
    } catch {
      return null;
    }
  })();
  const app = getTemplate(appId);
  const suggestions = isDesktop
    ? [
        "What does this app do?",
        "Show me the current screen",
        "Add a new feature",
      ]
    : undefined;

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
  const animateFrameSidebar = !sidebarFullscreen;
  const [renderFrameSidebar, setRenderFrameSidebar] =
    useState(showFrameSidebar);

  useEffect(() => {
    if (!animateFrameSidebar) {
      setRenderFrameSidebar(showFrameSidebar);
      return;
    }

    let unmountTimer: number | undefined;

    if (showFrameSidebar) {
      setRenderFrameSidebar(true);
    } else {
      unmountTimer = window.setTimeout(() => {
        setRenderFrameSidebar(false);
      }, SIDEBAR_ANIMATION_MS);
    }

    return () => {
      if (unmountTimer !== undefined) {
        window.clearTimeout(unmountTimer);
      }
    };
  }, [animateFrameSidebar, showFrameSidebar]);

  // Notify iframe of sidebar state
  function notifyIframe(mode: FrameMode, width: number, open: boolean) {
    const visibleOpen = getVisibleSidebarOpen(mode, open, isPresentationMode);
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "agentNative.sidebarMode",
        data: {
          mode: mode === "dev" ? "code" : "app",
          width,
          open: visibleOpen,
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
  }, [frameMode, sidebarWidth, sidebarOpen, isPresentationMode]);

  useEffect(() => {
    dispatchFrameSidebarStateChange(
      getVisibleSidebarOpen(frameMode, sidebarOpen, isPresentationMode),
      frameMode,
    );
  }, [frameMode, sidebarOpen, isPresentationMode]);

  useEffect(() => {
    const toggleHandler = () => setSidebarOpen((prev) => !prev);
    const openHandler = () => setSidebarOpen(true);
    const closeHandler = () => setSidebarOpen(false);
    window.addEventListener("agent-panel:toggle", toggleHandler);
    window.addEventListener("agent-panel:open", openHandler);
    window.addEventListener("agent-panel:close", closeHandler);
    return () => {
      window.removeEventListener("agent-panel:toggle", toggleHandler);
      window.removeEventListener("agent-panel:open", openHandler);
      window.removeEventListener("agent-panel:close", closeHandler);
    };
  }, []);

  useEffect(() => {
    const keydownHandler = (event: KeyboardEvent) => {
      if (!isAgentSidebarToggleShortcut(event)) return;
      event.preventDefault();
      window.dispatchEvent(new Event("agent-panel:toggle"));
    };
    window.addEventListener("keydown", keydownHandler);
    return () => window.removeEventListener("keydown", keydownHandler);
  }, []);

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
        } else if (forceOpen === false) {
          setSidebarOpen(false);
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
      // Relay chat bridge events from the iframe; the agent chat rejects
      // cross-origin messages, so re-dispatch same-origin so it accepts it.
      // Only relay from known app dev-server origins to prevent arbitrary
      // cross-origin pages from injecting agent messages.
      if (event.data.type === "agentNative.presentationMode") {
        setIsPresentationMode(event.data.data?.active === true);
        return;
      }
      if (
        event.data.type === "agentNative.submitChat" ||
        event.data.type === "agentNative.setChatContext"
      ) {
        const host = window.location.hostname || "localhost";
        const gatewayOrigin = (() => {
          const gatewayUrl = getTemplateGatewayUrl();
          if (!gatewayUrl) return null;
          try {
            return new URL(gatewayUrl).origin;
          } catch {
            return null;
          }
        })();
        const allowedOrigins = new Set([
          ...TEMPLATES.flatMap((a) => [
            `http://localhost:${a.devPort || 8080}`,
            `http://${host}:${a.devPort || 8080}`,
          ]),
          ...(gatewayOrigin ? [gatewayOrigin] : []),
          ...(customAppOrigin ? [customAppOrigin] : []),
        ]);
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
      className="agent-frame-shell flex h-screen w-screen overflow-hidden"
      style={{
        background: "hsl(var(--background))",
        color: "hsl(var(--foreground))",
      }}
    >
      {/* App iframe — takes all remaining space. Hidden when sidebar is fullscreen. */}
      <div
        className="agent-frame-main-surface flex-1 min-w-0 relative overflow-hidden"
        data-agent-frame-main-state={
          showFrameSidebar && !sidebarFullscreen ? "open" : "closed"
        }
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
          allow={APP_IFRAME_ALLOW}
        />
        {/* Overlay during drag to prevent iframe from capturing mouse events */}
        {isDragging && (
          <div className="absolute inset-0" style={{ cursor: "col-resize" }} />
        )}
      </div>

      {/* Dev mode sidebar — looks identical to the in-app agent panel */}
      {renderFrameSidebar && (
        <>
          {!sidebarFullscreen && showFrameSidebar && (
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
            className="agent-frame-sidebar flex flex-col shrink-0 overflow-hidden"
            data-agent-frame-sidebar-animation={
              animateFrameSidebar ? "desktop" : undefined
            }
            data-agent-frame-sidebar-state={
              showFrameSidebar ? "open" : "closed"
            }
            style={
              {
                "--agent-frame-sidebar-width": `${sidebarWidth}px`,
                width: animateFrameSidebar
                  ? undefined
                  : showFrameSidebar
                    ? sidebarFullscreen
                      ? "100%"
                      : sidebarWidth
                    : 0,
                flex: showFrameSidebar && sidebarFullscreen ? 1 : undefined,
                maxHeight: "100vh",
                minWidth: 0,
                pointerEvents: showFrameSidebar ? undefined : "none",
              } as CSSProperties & { "--agent-frame-sidebar-width": string }
            }
            inert={showFrameSidebar ? undefined : true}
            aria-hidden={showFrameSidebar ? undefined : true}
          >
            <div className="agent-frame-sidebar-inner flex min-h-0 flex-1 flex-col">
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
                  suggestions={suggestions}
                  onCollapse={() => setSidebarOpen(false)}
                  isFullscreen={sidebarFullscreen}
                  onToggleFullscreen={() =>
                    setSidebarFullscreen((prev) => !prev)
                  }
                  devAppUrl={appUrl}
                  storageKey={appId}
                  agentChatSurface="dev-frame"
                  codeAccess={{
                    enabled: isDesktop,
                    unavailableTitle: "Open Desktop to use CLI",
                    unavailableDescription:
                      "Open Agent Native Desktop, click the + button, and add this app with its local dev URL to use CLI.",
                    unavailableCtaLabel: "Open Desktop",
                    unavailableCtaHref: OPEN_DESKTOP_URL,
                    unavailableSecondaryCtaLabel: "Download",
                    unavailableSecondaryCtaHref: DOWNLOAD_DESKTOP_URL,
                  }}
                />
              </Suspense>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
