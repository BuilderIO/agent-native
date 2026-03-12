import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { settingsToFlags, type LaunchSettings } from "../lib/settings";

export interface UseTerminalOptions {
  appPort: number;
}

export function useTerminal({ appPort }: UseTerminalOptions) {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const autoReconnect = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [connected, setConnected] = useState(false);

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

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);

    termInstance.current = term;
    fitAddon.current = fit;

    // Delay fit until the container has its final layout size
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
    });

    // Terminal input -> WebSocket
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
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  }, []);

  const notifyApp = useCallback((isRunning: boolean) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "builder.fusion.chatRunning", detail: { isRunning } },
      "*"
    );
  }, []);

  const connect = useCallback((settings: LaunchSettings) => {
    const term = termInstance.current;
    if (!term) return;

    const flags = settingsToFlags(settings);
    const params = flags ? `?flags=${encodeURIComponent(flags)}` : "";
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws${params}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    let agentRunning = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    ws.onopen = () => {
      setConnected(true);
      // Send initial terminal size
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      const data =
        event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data)
          : event.data;
      term.write(data);

      // Idle detection: Claude shows "❯" when waiting for input
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
      if (autoReconnect.current) {
        term.write("\r\n\x1b[31m[harness] Connection closed. Reconnecting in 3s...\x1b[0m\r\n");
        setTimeout(() => connect(settings), 3000);
      }
    };

    ws.onerror = () => ws.close();

    // Listen for messages from app iframe
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
  }, [notifyApp]);

  const restart = useCallback((settings: LaunchSettings) => {
    autoReconnect.current = false;
    wsRef.current?.close();
    termInstance.current?.clear();
    termInstance.current?.write("\x1b[33m[harness] Restarting Claude Code...\x1b[0m\r\n");
    autoReconnect.current = true;
    setTimeout(() => connect(settings), 500);
  }, [connect]);

  const fit = useCallback(() => {
    fitAddon.current?.fit();
    sendResize();
  }, [sendResize]);

  return {
    termRef,
    iframeRef,
    connected,
    connect,
    restart,
    fit,
  };
}
