import { agentNativePath } from "../api-path.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface Tool {
  id: string;
  name: string;
  description?: string;
  content?: string;
  updatedAt?: string;
}

export interface EmbeddedToolProps {
  toolId: string;
  /** Slot identifier passed via the iframe URL so the tool runtime knows it's
   * embedded and enables auto-resize. */
  slotId: string;
  /** Object pushed into the tool as `window.slotContext`. Re-posted whenever
   * the host re-renders with a new context. */
  context?: Record<string, unknown> | null;
  /** Optional className applied to the iframe container. */
  className?: string;
  /** Initial iframe height before content reports a real height. */
  initialHeight?: number;
}

/**
 * Renders a tool inline as a small auto-sized iframe — for use inside an
 * `<ExtensionSlot>`. Different from `<ToolViewer>` (which is full-page with a
 * toolbar): no header, sized to content, receives a `slotContext`.
 */
export function EmbeddedTool({
  toolId,
  slotId,
  context,
  className,
  initialHeight = 80,
}: EmbeddedToolProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(initialHeight);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const { data: tool } = useQuery<Tool>({
    queryKey: ["tool", toolId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/tools/${toolId}`),
      );
      if (!res.ok) throw new Error("Failed to fetch tool");
      return res.json();
    },
  });

  const iframeSrc = useMemo(() => {
    const v = encodeURIComponent(tool?.updatedAt ?? "");
    return `/_agent-native/tools/${toolId}/render?slot=${encodeURIComponent(slotId)}&dark=${isDark}&v=${v}`;
  }, [toolId, slotId, isDark, tool?.updatedAt]);

  // Forward slot context whenever it changes. The iframe's own load handler
  // posts the initial value once it's ready; this effect handles updates.
  const contextJson = JSON.stringify(context ?? {});
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { type: "agent-native-slot-context", context: context ?? {} },
      "*",
    );
  }, [contextJson]);

  // Bridge tool requests + height reports.
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "agent-native-tool-resize") {
        const h = Number(message.height);
        if (Number.isFinite(h) && h > 0) {
          setHeight(Math.ceil(h));
        }
        return;
      }

      if (message.type !== "agent-native-tool-request") return;

      const requestId = String(message.requestId ?? "");
      const path = String(message.path ?? "");
      const respond = (payload: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "agent-native-tool-response", requestId, ...payload },
          "*",
        );
      };

      if (!requestId || !isAllowedToolPath(path)) {
        respond({ error: "Tool request path is not allowed" });
        return;
      }

      try {
        const options = sanitizeToolRequestOptions(message.options);
        const res = await fetch(path, {
          ...options,
          credentials: "same-origin",
        });
        const text = await res.text();
        let body: unknown = text;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        respond({
          response: {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            body,
          },
        });
      } catch (err: any) {
        respond({ error: err?.message ?? "Tool host request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (!tool) {
    return (
      <div
        className={className}
        style={{ height: initialHeight }}
        aria-busy="true"
      />
    );
  }

  return (
    <iframe
      ref={iframeRef}
      key={`${toolId}-${tool.updatedAt ?? ""}`}
      src={iframeSrc}
      className={className}
      title={tool.name}
      sandbox="allow-scripts allow-forms"
      style={{ width: "100%", border: 0, height }}
      onLoad={() => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "agent-native-slot-context", context: context ?? {} },
          "*",
        );
      }}
    />
  );
}

function isAllowedToolPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  // Reject path traversal: normalize via URL and check the resolved path didn't escape.
  try {
    const resolved = new URL(path, "http://x").pathname;
    if (resolved.includes("..") || resolved !== path.split("?")[0])
      return false;
  } catch {
    return false;
  }
  return true;
}

function sanitizeToolRequestOptions(value: unknown): RequestInit {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const method =
    typeof raw.method === "string" && raw.method.trim()
      ? raw.method.toUpperCase()
      : "GET";
  const headers =
    raw.headers && typeof raw.headers === "object"
      ? Object.fromEntries(
          Object.entries(raw.headers as Record<string, unknown>)
            .filter(([key, val]) => isAllowedHeader(key) && val !== undefined)
            .map(([key, val]) => [key, String(val)]),
        )
      : undefined;
  const body =
    typeof raw.body === "string" ||
    raw.body instanceof Blob ||
    raw.body instanceof FormData
      ? raw.body
      : raw.body === undefined
        ? undefined
        : JSON.stringify(raw.body);

  return {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  };
}

function isAllowedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return !["cookie", "host", "origin", "referer"].includes(lower);
}
