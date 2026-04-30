/**
 * AgentTerminal — Embeddable CLI terminal component
 *
 * Renders an xterm.js terminal connected to a PTY WebSocket server.
 * When running inside a frame, renders nothing (the frame manages the terminal).
 *
 * Usage:
 *   import { AgentTerminal } from "@agent-native/core/terminal";
 *   <AgentTerminal className="w-full h-[400px]" />
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import { agentNativePath } from "../api-path.js";
import { getFrameOrigin } from "../frame.js";

export interface AgentTerminalProps {
  /** CLI command to run. Default: 'builder' */
  command?: string;
  /** Additional CLI flags */
  flags?: string;
  /** Custom WebSocket URL (overrides auto-discovery) */
  wsUrl?: string;
  /** Hide when running inside frame. Default: true */
  hideInFrame?: boolean;
  /** Terminal theme overrides */
  theme?: Record<string, string>;
  /** Font size. Default: 12 */
  fontSize?: number;
  /** CSS class for the container */
  className?: string;
  /** Inline styles for the container */
  style?: CSSProperties;
  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  /** Callback when agent running state changes */
  onAgentRunningChange?: (running: boolean) => void;
}

// Inject xterm CSS once
let cssInjected = false;
function injectXtermCss() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .xterm { position: relative; user-select: none; }
    .xterm.focus, .xterm:focus { outline: none; }
    .xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
    .xterm .xterm-helper-textarea {
      padding: 0; border: 0; margin: 0;
      position: absolute; opacity: 0; left: -9999em; top: 0;
      width: 0; height: 0; z-index: -5;
      white-space: nowrap; overflow: hidden; resize: none;
    }
    .xterm .composition-view { display: none; position: absolute; white-space: nowrap; z-index: 1; }
    .xterm .composition-view.active { display: block; }
    .xterm .xterm-viewport {
      background-color: #000; overflow-y: scroll;
      cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0;
    }
    .xterm .xterm-screen { position: relative; }
    .xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
    .xterm .xterm-scroll-area { visibility: hidden; }
    .xterm-char-measure-element {
      display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em;
      line-height: normal;
    }
    .xterm.enable-mouse-events { cursor: default; }
    .xterm.xterm-cursor-pointer, .xterm .xterm-cursor-pointer { cursor: pointer; }
    .xterm.column-select.focus { cursor: crosshair; }
    .xterm .xterm-accessibility:not(.debug),
    .xterm .xterm-message { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; pointer-events: none; }
    .xterm .xterm-accessibility-tree:not(.debug) *::selection { color: transparent; }
    .xterm .xterm-accessibility-tree { user-select: text; white-space: pre; }
    .xterm .live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    .xterm .xterm-dim { opacity: 0.5; }
    .xterm .xterm-underline-1 { text-decoration: underline; }
    .xterm .xterm-underline-2 { text-decoration: double underline; }
    .xterm .xterm-underline-3 { text-decoration: wavy underline; }
    .xterm .xterm-underline-4 { text-decoration: dotted underline; }
    .xterm .xterm-underline-5 { text-decoration: dashed underline; }
    .xterm .xterm-overline { text-decoration: overline; }
    .xterm .xterm-strikethrough { text-decoration: line-through; }
    .xterm .xterm-screen .xterm-decoration-container .xterm-decoration { z-index: 6; position: absolute; }
    .xterm .xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer { z-index: 7; }
    .xterm .xterm-decoration-overview-ruler { z-index: 8; position: absolute; top: 0; right: 0; pointer-events: none; }
    .xterm .xterm-decoration-top { z-index: 2; position: relative; }
  `;
  document.head.appendChild(style);
}

const DEFAULT_THEME = {
  background: "#111",
  foreground: "#e0e0e0",
  cursor: "#58a6ff",
  selectionBackground: "#264f78",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#b1bac4",
};

interface TerminalInfo {
  available: boolean;
  wsPort?: number;
  command?: string;
  error?: string;
}

export function AgentTerminal({
  command,
  flags,
  wsUrl: wsUrlProp,
  hideInFrame = true,
  theme,
  fontSize = 12,
  className,
  style,
  onConnectionChange,
  onAgentRunningChange,
}: AgentTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inFrame, setInFrame] = useState(false);

  // Check frame state after mount (postMessage is async)
  useEffect(() => {
    if (!hideInFrame) return;
    // Check immediately and also after a short delay for the postMessage to arrive
    const check = () => {
      if (getFrameOrigin()) setInFrame(true);
    };
    check();
    const timer = setTimeout(check, 500);
    return () => clearTimeout(timer);
  }, [hideInFrame]);

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange?.(connected);
  }, [connected, onConnectionChange]);

  // Main terminal setup
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hideInFrame && inFrame) return;

    const container = termRef.current;
    if (!container) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let cleanupMessageHandler: (() => void) | null = null;

    async function init() {
      // Dynamic imports for SSR safety
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all(
        [
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-web-links"),
        ],
      );

      if (disposed || !container) return;

      injectXtermCss();

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: { ...DEFAULT_THEME, ...theme },
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        window.open(uri, "_blank", "noopener");
      });

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(container);

      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {}
      });

      // Resize observer for auto-fitting
      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            sendResize();
          } catch {}
        });
      });
      resizeObserver.observe(container);

      // Discover WebSocket URL
      let wsUrl = wsUrlProp;
      if (!wsUrl) {
        try {
          const res = await fetch(
            agentNativePath("/_agent-native/agent-terminal-info"),
          );
          const info: TerminalInfo = await res.json();
          if (!info.available) {
            setError(info.error || "Agent terminal not available");
            return;
          }
          const protocol = location.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = `${protocol}//${location.hostname}:${info.wsPort}/ws`;
          if (!command && info.command) {
            command = info.command;
          }
        } catch (err) {
          setError("Failed to discover terminal server");
          return;
        }
      }

      // Build WebSocket URL with query params
      const qs = new URLSearchParams();
      if (command) qs.set("command", command);
      if (flags) qs.set("flags", flags);
      const qsStr = qs.toString();
      const fullWsUrl = qsStr ? `${wsUrl}?${qsStr}` : wsUrl;

      // Connect WebSocket
      let agentRunning = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let connectionId = 0;

      function sendResize() {
        if (ws && ws.readyState === WebSocket.OPEN && term) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        }
      }

      function notifyAgentRunning(running: boolean) {
        onAgentRunningChange?.(running);
        window.dispatchEvent(
          new CustomEvent("builder.chatRunning", {
            detail: { isRunning: running },
          }),
        );
      }

      function connect(url: string) {
        const thisId = ++connectionId;

        if (ws) {
          ws.close();
          ws = null;
        }

        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        ws = socket;

        socket.onopen = () => {
          setConnected(true);
          setError(null);
          socket.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        };

        socket.onmessage = (event) => {
          const data =
            event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : event.data;

          // Check for setup-status JSON messages
          try {
            const msg = JSON.parse(data);
            if (msg.type === "setup-status") {
              if (msg.status === "not-found" || msg.status === "failed") {
                setError(msg.message);
                // Bump connectionId to suppress reconnect on close
                connectionId++;
              }
              return;
            }
          } catch {
            // Not JSON — regular terminal output
          }

          setError(null);
          term.write(data);

          // Idle detection — prompt or cursor visible means agent stopped
          if (data.includes("❯") || data.includes("\x1b[?25h")) {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              if (agentRunning) {
                agentRunning = false;
                notifyAgentRunning(false);
              }
            }, 600);
          } else if (agentRunning) {
            if (idleTimer) clearTimeout(idleTimer);
          }
        };

        socket.onclose = () => {
          setConnected(false);
          if (connectionId === thisId && !disposed) {
            term.write(
              "\r\n\x1b[31m[terminal] Connection closed. Reconnecting in 3s...\x1b[0m\r\n",
            );
            setTimeout(() => {
              if (connectionId === thisId && !disposed) {
                connect(url);
              }
            }, 3000);
          }
        };

        socket.onerror = () => socket.close();
      }

      // Terminal input → WebSocket
      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Chat bridge integration — listen for sendToAgentChat messages
      const messageHandler = (event: MessageEvent) => {
        // Only accept messages from same origin or known frame
        if (
          event.origin !== window.location.origin &&
          event.origin !== getFrameOrigin()
        ) {
          return;
        }
        if (event.data?.type === "builder.submitChat") {
          const message = event.data.data?.message;
          if (message && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(message + "\r");
            agentRunning = true;
            notifyAgentRunning(true);
          }
        }
      };
      window.addEventListener("message", messageHandler);
      cleanupMessageHandler = () =>
        window.removeEventListener("message", messageHandler);

      connect(fullWsUrl);

      // Store cleanup references
      return () => {
        disposed = true;
        connectionId++;
        if (idleTimer) clearTimeout(idleTimer);
        resizeObserver.disconnect();
        if (ws) {
          ws.close();
          ws = null;
        }
        term.dispose();
      };
    }

    let cleanup: (() => void) | undefined;
    init().then((fn) => {
      cleanup = fn;
    });

    return () => {
      disposed = true;
      cleanup?.();
      cleanupMessageHandler?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideInFrame, inFrame, command]);

  if (hideInFrame && inFrame) {
    return null;
  }

  const terminalBackground = theme?.background ?? DEFAULT_THEME.background;
  const mergedStyle = {
    ...style,
    background: terminalBackground,
    backgroundColor: terminalBackground,
  };

  return (
    <div
      ref={termRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        padding: "4px 12px",
        position: "relative",
        ...mergedStyle,
      }}
    >
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#111",
            color: "#ff7b72",
            fontSize: "13px",
            fontFamily: "monospace",
            padding: "20px",
            textAlign: "center",
            zIndex: 1,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
