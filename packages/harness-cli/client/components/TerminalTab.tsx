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
  /** Send a chat message into the PTY. Returns true if sent. */
  sendChatMessage(text: string): boolean;
  /** Whether the agent is currently running in this tab */
  isAgentRunning(): boolean;
}

interface TerminalTabProps {
  active: boolean;
  config: HarnessConfig;
  settings: LaunchSettings;
  appName: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onConnectedChange?: (connected: boolean) => void;
  onSetupStatusChange?: (status: SetupStatus) => void;
  /** Callback when the agent running state changes in this tab */
  onAgentRunningChange?: (running: boolean) => void;
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
      onAgentRunningChange,
    },
    ref,
  ) {
    const termRef = useRef<HTMLDivElement>(null);
    const termInstance = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [setupStatus, setSetupStatus] = useState<SetupStatus>({
      status: "none",
      message: "",
    });
    const connectionId = useRef(0);
    const settingsRef = useRef(settings);
    const appNameRef = useRef(appName);
    const agentRunningRef = useRef(false);
    const onAgentRunningChangeRef = useRef(onAgentRunningChange);
    settingsRef.current = settings;
    appNameRef.current = appName;
    onAgentRunningChangeRef.current = onAgentRunningChange;

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

          // Idle detection
          if (data.includes("❯") || data.includes("\x1b[?25h")) {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              if (agentRunningRef.current) {
                agentRunningRef.current = false;
                notifyApp(false);
                onAgentRunningChangeRef.current?.(false);
              }
            }, 600);
          } else if (agentRunningRef.current) {
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

        return () => {
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

    useImperativeHandle(ref, () => ({
      fit,
      restart,
      getConnected: () => connected,
      getSetupStatus: () => setupStatus,
      sendChatMessage(text: string): boolean {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(text + "\r");
          agentRunningRef.current = true;
          notifyApp(true);
          onAgentRunningChangeRef.current?.(true);
          return true;
        }
        return false;
      },
      isAgentRunning(): boolean {
        return agentRunningRef.current;
      },
    }));

    return (
      <div
        ref={termRef}
        className="w-full h-full py-1 pl-3 pr-1"
        style={{ display: active ? "block" : "none" }}
      />
    );
  },
);
