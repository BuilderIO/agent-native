import { agentNativePath } from "../api-path.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isAllowedToolPath,
  sanitizeToolRequestOptions,
  checkBridgePolicy,
  type ToolBridgeRole,
} from "./iframe-bridge.js";

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
  // (audit H4) Mirror ToolViewer's role-aware gating; deny-by-default until
  // the iframe's render binding announcement arrives.
  const bridgeContextRef = useRef<{
    role: ToolBridgeRole;
    isAuthor: boolean;
  }>({
    role: "viewer",
    isAuthor: false,
  });

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
    return agentNativePath(
      `/_agent-native/tools/${toolId}/render?slot=${encodeURIComponent(slotId)}&dark=${isDark}&v=${v}`,
    );
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

      if (message.type === "agent-native-tool-binding") {
        const binding = (message as any).binding ?? {};
        const role: ToolBridgeRole =
          binding.role === "owner" ||
          binding.role === "admin" ||
          binding.role === "editor" ||
          binding.role === "viewer"
            ? binding.role
            : "viewer";
        bridgeContextRef.current = {
          role,
          isAuthor: !!binding.isAuthor,
        };
        return;
      }

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

      if (!requestId || !isAllowedToolPath(path, toolId)) {
        respond({ error: "Tool request path is not allowed" });
        return;
      }

      try {
        const options = sanitizeToolRequestOptions(message.options);
        // (audit H4) Role-aware gating: viewer-shared tools can read but not
        // write. The bridge policy is decided here in the parent before the
        // request leaves; the server enforces a second layer.
        const policy = checkBridgePolicy(
          path,
          options.method ?? "GET",
          bridgeContextRef.current,
        );
        if (!policy.ok) {
          respond({
            response: {
              ok: false,
              status: 403,
              statusText: "Forbidden",
              body: { error: policy.error },
            },
          });
          return;
        }
        // (audit H5) Same tool-bridge tagging as <ToolViewer>. action-routes
        // uses these headers to enforce per-action `toolCallable` opt-in.
        const finalHeaders = new Headers(options.headers ?? undefined);
        finalHeaders.set("X-Agent-Native-Tool-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Tool-Id", toolId);
        const res = await fetch(agentNativePath(path), {
          ...options,
          headers: finalHeaders,
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
  }, [toolId]);

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
