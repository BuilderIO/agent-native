import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { settingsToFlags, type LaunchSettings } from "../lib/settings";
import { useHarnessConfig } from "../lib/config";

export type SetupStatus = {
  status: "none" | "installing" | "installed" | "not-found" | "failed";
  message: string;
};

export function useTerminal() {
  const config = useHarnessConfig();
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>({
    status: "none",
    message: "",
  });

  // Connection ID — incremented each time connect is called.
  // Old onclose handlers check this to avoid reconnecting stale connections.
  const connectionId = useRef(0);

  // Initialize terminal
  useEffect(() => {
    if (!termRef.current || termInstance.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 11,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#1e1e1e",
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

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);

    termInstance.current = term;
    fitAddon.current = fit;

    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {}
    });

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      term.dispose();
      termInstance.current = null;
    };
  }, []);

  const sendResize = useCallback(() => {
    const ws = wsRef.current;
    const term = termInstance.current;
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    }
  }, []);

  const notifyApp = useCallback((isRunning: boolean) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "builder.fusion.chatRunning", detail: { isRunning } },
      "*",
    );
  }, []);

  const connect = useCallback(
    (settings: LaunchSettings, appName: string) => {
      const term = termInstance.current;
      if (!term) return;

      // Increment connection ID to invalidate any old onclose handlers
      const thisConnectionId = ++connectionId.current;

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const flags = settingsToFlags(settings, config);
      const qs = new URLSearchParams();
      if (flags) qs.set("flags", flags);
      qs.set("command", config.command);
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${location.host}/ws/${appName}?${qs.toString()}`,
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
        // Don't reconnect if install failed — user must click Retry
        setSetupStatus((prev) => {
          if (prev.status === "failed" || prev.status === "not-found")
            return prev;
          // Only reconnect if this is still the current connection
          if (connectionId.current === thisConnectionId) {
            term.write(
              "\r\n\x1b[31m[harness] Connection closed. Reconnecting in 3s...\x1b[0m\r\n",
            );
            setTimeout(() => {
              if (connectionId.current === thisConnectionId) {
                connect(settings, appName);
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
    (settings: LaunchSettings, appName: string) => {
      wsRef.current?.close();
      termInstance.current?.reset();
      connect(settings, appName);
    },
    [connect],
  );

  const fit = useCallback(() => {
    fitAddon.current?.fit();
    sendResize();
  }, [sendResize]);

  return {
    termRef,
    iframeRef,
    connected,
    setupStatus,
    connect,
    restart,
    fit,
  };
}
