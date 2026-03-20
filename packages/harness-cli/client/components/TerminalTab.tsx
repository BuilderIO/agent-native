import {
  useRef,
  useEffect,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { settingsToFlags, type LaunchSettings } from "../lib/settings";
import type { HarnessConfig } from "../lib/config";

export type SetupStatus = {
  status: "none" | "installing" | "installed" | "not-found" | "failed";
  message: string;
};

export interface TerminalTabHandle {
  fit(): void;
  restart(settings: LaunchSettings, appName: string): void;
  getConnected(): boolean;
  getSetupStatus(): SetupStatus;
}

interface TerminalTabProps {
  active: boolean;
  config: HarnessConfig;
  settings: LaunchSettings;
  appName: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onConnectedChange?: (connected: boolean) => void;
  onSetupStatusChange?: (status: SetupStatus) => void;
}

export const TerminalTab = forwardRef<TerminalTabHandle, TerminalTabProps>(
  function TerminalTab(
    {
      active,
      config,
      settings,
      appName,
      iframeRef,
      onConnectedChange,
      onSetupStatusChange,
    },
    ref,
  ) {
    const termRef = useRef<HTMLDivElement>(null);
    const termInstance = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [oauthUrl, setOauthUrl] = useState<string | null>(null);
    const urlBuffer = useRef("");
    const [setupStatus, setSetupStatus] = useState<SetupStatus>({
      status: "none",
      message: "",
    });
    const connectionId = useRef(0);
    const settingsRef = useRef(settings);
    const appNameRef = useRef(appName);
    settingsRef.current = settings;
    appNameRef.current = appName;

    // Notify parent of state changes
    useEffect(() => {
      onConnectedChange?.(connected);
    }, [connected, onConnectedChange]);

    useEffect(() => {
      onSetupStatusChange?.(setupStatus);
    }, [setupStatus, onSetupStatusChange]);

    const sendResize = useCallback(() => {
      const ws = wsRef.current;
      const term = termInstance.current;
      if (ws && ws.readyState === WebSocket.OPEN && term) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      }
    }, []);

    const notifyApp = useCallback(
      (isRunning: boolean) => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "builder.fusion.chatRunning", detail: { isRunning } },
          "*",
        );
      },
      [iframeRef],
    );

    const connect = useCallback(
      (s: LaunchSettings, app: string) => {
        const term = termInstance.current;
        if (!term) return;

        const thisConnectionId = ++connectionId.current;

        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }

        const flags = settingsToFlags(s, config);
        const qs = new URLSearchParams();
        if (flags) qs.set("flags", flags);
        qs.set("command", config.command);
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(
          `${protocol}//${location.host}/ws/${app}?${qs.toString()}`,
        );
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        let agentRunning = false;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        ws.onopen = () => {
          setConnected(true);
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        };

        ws.onmessage = (event) => {
          const data =
            event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : event.data;

          try {
            const msg = JSON.parse(data);
            if (msg.type === "setup-status") {
              setSetupStatus({ status: msg.status, message: msg.message });
              return;
            }
          } catch {
            // Not JSON — regular terminal output
          }

          setSetupStatus((prev) =>
            prev.status !== "none" ? { status: "none", message: "" } : prev,
          );

          term.write(data);

          // Detect OAuth URLs that span multiple terminal chunks
          // Strip all ANSI escapes: CSI (ESC[…), OSC (ESC]…BEL/ST), and 2-char (ESC + char)
          const plain = data.replace(
            /\x1b(?:\[[^a-zA-Z]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[^[\]])/g,
            "",
          );
          urlBuffer.current += plain;
          // Keep buffer from growing unbounded — only keep last 2KB
          if (urlBuffer.current.length > 2048) {
            urlBuffer.current = urlBuffer.current.slice(-2048);
          }
          // Collapse whitespace first so a line wrap between "authorize" and "?"
          // doesn't prevent detection.
          const collapsed = urlBuffer.current.replace(/\s+/g, " ");
          const startIdx = collapsed.indexOf(
            "https://claude.ai/oauth/authorize?",
          );
          if (startIdx !== -1) {
            const chunk = collapsed.slice(startIdx, startIdx + 600);
            const stripped = chunk.replace(/\s+/g, "");
            const urlMatch = stripped.match(
              /https:\/\/claude\.ai\/oauth\/authorize\?[A-Za-z0-9%&=+:_.~\-\/]+/,
            );
            if (urlMatch && urlMatch[0].includes("state=")) {
              setOauthUrl(urlMatch[0]);
              urlBuffer.current = "";
            }
          }

          // Idle detection
          if (data.includes("❯") || data.includes("\x1b[?25h")) {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              if (agentRunning) {
                agentRunning = false;
                notifyApp(false);
              }
            }, 600);
          } else if (agentRunning) {
            if (idleTimer) clearTimeout(idleTimer);
          }
        };

        ws.onclose = () => {
          setConnected(false);
          setSetupStatus((prev) => {
            if (prev.status === "failed" || prev.status === "not-found")
              return prev;
            if (connectionId.current === thisConnectionId) {
              term.write(
                "\r\n\x1b[31m[harness] Connection closed. Reconnecting in 3s...\x1b[0m\r\n",
              );
              setTimeout(() => {
                if (connectionId.current === thisConnectionId) {
                  connect(settingsRef.current, appNameRef.current);
                }
              }, 3000);
            }
            return prev;
          });
        };

        ws.onerror = () => ws.close();

        const messageHandler = (event: MessageEvent) => {
          if (event.data?.type === "builder.submitChat") {
            const message = event.data.data?.message;
            if (message && ws.readyState === WebSocket.OPEN) {
              ws.send(message + "\r");
              agentRunning = true;
              notifyApp(true);
            }
          }
        };
        window.addEventListener("message", messageHandler);

        return () => {
          window.removeEventListener("message", messageHandler);
          if (idleTimer) clearTimeout(idleTimer);
        };
      },
      [config, notifyApp],
    );

    const restart = useCallback(
      (s: LaunchSettings, app: string) => {
        wsRef.current?.close();
        termInstance.current?.reset();
        connect(s, app);
      },
      [connect],
    );

    const fit = useCallback(() => {
      fitAddon.current?.fit();
      sendResize();
    }, [sendResize]);

    // Initialize terminal
    useEffect(() => {
      if (!termRef.current || termInstance.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background: "#000000",
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
        },
      });

      const fitAd = new FitAddon();
      const webLinksAd = new WebLinksAddon((_event, uri) => {
        window.open(uri, "_blank", "noopener");
      });
      term.loadAddon(fitAd);
      term.loadAddon(webLinksAd);
      term.open(termRef.current);

      termInstance.current = term;
      fitAddon.current = fitAd;

      requestAnimationFrame(() => {
        try {
          fitAd.fit();
        } catch {}
      });

      term.onData((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Auto-connect on mount
      connect(settingsRef.current, appNameRef.current);

      return () => {
        // Kill WebSocket on unmount (closes PTY server-side)
        if (wsRef.current) {
          connectionId.current++;
          wsRef.current.close();
          wsRef.current = null;
        }
        term.dispose();
        termInstance.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-fit when becoming active
    useEffect(() => {
      if (active) {
        requestAnimationFrame(() => fit());
      }
    }, [active, fit]);

    // Refit terminal when OAuth banner appears/disappears
    useEffect(() => {
      requestAnimationFrame(() => fit());
    }, [oauthUrl, fit]);

    useImperativeHandle(ref, () => ({
      fit,
      restart,
      getConnected: () => connected,
      getSetupStatus: () => setupStatus,
    }));

    return (
      <div
        className="relative w-full h-full"
        style={{ display: active ? "block" : "none" }}
      >
        {oauthUrl && (
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-[#1a3a5c] border-b border-[#58a6ff]/30 text-xs">
            <span className="text-[#e0e0e0] shrink-0">
              OAuth link detected:
            </span>
            <a
              href={oauthUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:underline truncate"
            >
              {oauthUrl}
            </a>
            <button
              onClick={() => setOauthUrl(null)}
              className="shrink-0 text-white/50 hover:text-white/80 ml-auto"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        )}
        <div
          ref={termRef}
          className={`w-full h-full py-1 pl-3 pr-1 ${oauthUrl ? "pt-8" : ""}`}
        />
      </div>
    );
  },
);
