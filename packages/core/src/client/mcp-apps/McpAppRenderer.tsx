import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import { agentNativePath } from "../api-path.js";
import { cn } from "../utils.js";

const DEFAULT_IFRAME_HEIGHT = 360;
const MAX_IFRAME_HEIGHT = 900;
const SANDBOX_FLAGS = "allow-scripts allow-forms allow-popups";

export interface McpAppRendererProps {
  app: AgentMcpAppPayload;
  className?: string;
}

type ResourceUiMeta = {
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
  prefersBorder?: boolean;
};

export function McpAppRenderer({ app, className }: McpAppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loadedSrcDoc, setLoadedSrcDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(DEFAULT_IFRAME_HEIGHT);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const resourceHtml = app.resource ? htmlFromResource(app.resource) : "";
  const uiMeta = useMemo(() => resourceUiMeta(app), [app]);
  const supportedPermissions = useMemo(
    () => supportedMcpAppPermissions(uiMeta.permissions),
    [uiMeta.permissions],
  );
  const csp = buildMcpAppCsp(uiMeta.csp);
  const srcDoc = useMemo(
    () => (resourceHtml ? injectCsp(resourceHtml, csp) : ""),
    [resourceHtml, csp],
  );

  useEffect(() => {
    setLoadedSrcDoc(null);
    setReady(false);
    setError(null);
  }, [srcDoc]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !srcDoc || loadedSrcDoc !== srcDoc) return;

    let closed = false;
    const bridge = new AppBridge(
      null,
      { name: "Agent Native", version: "1.0.0" },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        sandbox: {
          permissions: supportedPermissions,
          csp: uiMeta.csp ?? {},
        },
      },
      {
        hostContext: buildHostContext(app) as any,
      },
    );

    bridge.addEventListener("sizechange", ({ height: nextHeight }) => {
      if (typeof nextHeight !== "number" || !Number.isFinite(nextHeight)) {
        return;
      }
      setHeight(
        Math.min(MAX_IFRAME_HEIGHT, Math.max(220, Math.ceil(nextHeight))),
      );
    });
    bridge.addEventListener("initialized", () => {
      if (closed) return;
      setReady(true);
      void bridge.sendToolInput({ arguments: app.toolInput });
      void bridge.sendToolResult(app.toolResult as CallToolResult);
    });
    bridge.addEventListener("loggingmessage", ({ level, data }) => {
      if (level === "error" || level === "critical" || level === "alert") {
        console.warn("[mcp-app]", data);
      }
    });
    bridge.onopenlink = async ({ url }) => {
      if (!isSafeExternalUrl(url)) return { isError: true };
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.oncalltool = async ({ name, arguments: toolArguments }) => {
      const toolName = normalizeSameServerToolName(app.serverId, name);
      if (!toolName) {
        return errorToolResult("Cross-server MCP App tool calls are blocked.");
      }
      try {
        return await postMcpAppEndpoint<CallToolResult>("call-tool", {
          serverId: app.serverId,
          toolName,
          arguments:
            toolArguments && typeof toolArguments === "object"
              ? toolArguments
              : {},
        });
      } catch (err: any) {
        return errorToolResult(err?.message ?? "MCP App tool call failed.");
      }
    };
    (bridge as any).onlisttools = async () =>
      postMcpAppEndpoint("list-tools", { serverId: app.serverId });
    bridge.onreadresource = async ({ uri }) =>
      postMcpAppEndpoint("read-resource", { serverId: app.serverId, uri });
    bridge.onlistresources = async () => ({ resources: [] });
    bridge.onlistresourcetemplates = async () => ({ resourceTemplates: [] });
    bridge.ondownloadfile = async () => ({ isError: true });
    bridge.onmessage = async () => ({ isError: true });
    bridge.onupdatemodelcontext = async () => ({});

    const transport = new PostMessageTransport(
      iframe.contentWindow,
      iframe.contentWindow,
    );
    setReady(false);
    setError(null);
    bridge.connect(transport).catch((err: any) => {
      if (!closed) {
        setError(err?.message ?? "Failed to initialize MCP App.");
      }
    });

    return () => {
      closed = true;
      setReady(false);
      void bridge
        .teardownResource({}, { timeout: 500 })
        .catch(() => undefined)
        .finally(() => {
          void (bridge as any).close?.().catch?.(() => undefined);
        });
    };
  }, [app, loadedSrcDoc, srcDoc, supportedPermissions, uiMeta.csp]);

  if (!resourceHtml) {
    return (
      <div className={cn("agent-mcp-app agent-mcp-app--error", className)}>
        <IconAlertTriangle size={15} />
        <span>MCP App resource was not available.</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "agent-mcp-app",
        uiMeta.prefersBorder === false && "agent-mcp-app--flush",
        className,
      )}
    >
      {!ready && !error && (
        <div className="agent-mcp-app__loading">
          <IconLoader2 size={14} className="agent-conversation-spin" />
          <span>Loading MCP App</span>
        </div>
      )}
      {error && (
        <div className="agent-mcp-app__error">
          <IconAlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={app.tool?.title ?? app.originalToolName}
        srcDoc={srcDoc}
        sandbox={SANDBOX_FLAGS}
        allow={buildAllowAttribute(supportedPermissions)}
        style={{ height }}
        onLoad={() => setLoadedSrcDoc(srcDoc)}
      />
    </div>
  );
}

function resourceUiMeta(app: AgentMcpAppPayload): ResourceUiMeta {
  const meta = app.resource?._meta;
  const ui =
    meta?.ui && typeof meta.ui === "object" && !Array.isArray(meta.ui)
      ? (meta.ui as ResourceUiMeta)
      : {};
  return ui;
}

function htmlFromResource(
  resource: NonNullable<AgentMcpAppPayload["resource"]>,
): string {
  if (typeof resource.text === "string") return resource.text;
  if (typeof resource.blob !== "string") return "";
  try {
    if (typeof atob !== "function") return "";
    return atob(resource.blob);
  } catch {
    return "";
  }
}

export function supportedMcpAppPermissions(
  permissions: McpUiResourcePermissions | undefined,
): McpUiResourcePermissions {
  return permissions?.clipboardWrite ? { clipboardWrite: {} } : {};
}

export function buildMcpAppCsp(csp: McpUiResourceCsp | undefined): string {
  const connect = sanitizeCspSources(csp?.connectDomains);
  const resources = sanitizeCspSources(csp?.resourceDomains);
  const frames = sanitizeCspSources(csp?.frameDomains);
  const base = sanitizeCspSources(csp?.baseUriDomains);
  return [
    "default-src 'none'",
    `base-uri ${base.length ? base.join(" ") : "'none'"}`,
    "form-action 'none'",
    `connect-src ${connect.length ? connect.join(" ") : "'none'"}`,
    `img-src data: blob:${resources.length ? ` ${resources.join(" ")}` : ""}`,
    `media-src data: blob:${resources.length ? ` ${resources.join(" ")}` : ""}`,
    `font-src data:${resources.length ? ` ${resources.join(" ")}` : ""}`,
    `style-src 'unsafe-inline'${resources.length ? ` ${resources.join(" ")}` : ""}`,
    `script-src 'unsafe-inline'${resources.length ? ` ${resources.join(" ")}` : ""}`,
    `frame-src ${frames.length ? frames.join(" ") : "'none'"}`,
  ].join("; ");
}

function sanitizeCspSources(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const value of values ?? []) {
    const source = sanitizeCspSource(value);
    if (source) out.push(source);
  }
  return [...new Set(out)];
}

function sanitizeCspSource(value: string): string | null {
  const source = value.trim();
  if (!source || source.includes("'") || /[\s;]/.test(source)) return null;
  if (source === "https:") return source;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\*$/i.test(source)) {
    return source;
  }
  if (/^https:\/\/\*\.[a-z0-9.-]+(?::\d+)?$/i.test(source)) return source;
  try {
    const url = new URL(source);
    if (url.protocol === "https:") return url.origin;
    if (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function injectCsp(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${meta}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (htmlTag) => `${htmlTag}<head>${meta}</head>`,
    );
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function buildHostContext(app: AgentMcpAppPayload) {
  const root =
    typeof window !== "undefined"
      ? getComputedStyle(document.documentElement)
      : null;
  const cssVar = (name: string) => root?.getPropertyValue(name).trim() || "";
  const theme =
    typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") ||
      window.matchMedia?.("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
  return {
    toolInfo: app.tool
      ? {
          tool: {
            name: app.originalToolName,
            description: app.tool.description,
            inputSchema: app.tool.inputSchema ?? {
              type: "object",
              properties: {},
            },
            ...(app.tool._meta ? { _meta: app.tool._meta } : {}),
          },
        }
      : undefined,
    theme,
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    platform: "web",
    userAgent: "agent-native",
    locale: typeof navigator !== "undefined" ? navigator.language : undefined,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    containerDimensions: {
      maxHeight: MAX_IFRAME_HEIGHT,
      maxWidth: typeof window !== "undefined" ? window.innerWidth : undefined,
    },
    styles: {
      variables: {
        "--color-background-primary": hslVar(cssVar("--background")),
        "--color-background-secondary": hslVar(cssVar("--muted")),
        "--color-text-primary": hslVar(cssVar("--foreground")),
        "--color-text-secondary": hslVar(cssVar("--muted-foreground")),
        "--color-border-primary": hslVar(cssVar("--border")),
        "--font-sans": cssVar("--font-sans") || "ui-sans-serif, system-ui",
        "--font-mono":
          cssVar("--font-mono") ||
          "ui-monospace, SFMono-Regular, Menlo, monospace",
        "--border-radius-md": cssVar("--radius") || "8px",
      },
    },
  };
}

function hslVar(value: string): string | undefined {
  return value ? `hsl(${value})` : undefined;
}

function normalizeSameServerToolName(
  serverId: string,
  rawName: string,
): string | null {
  if (!rawName.trim()) return null;
  const prefix = `mcp__${serverId}__`;
  if (rawName.startsWith("mcp__")) {
    return rawName.startsWith(prefix) ? rawName.slice(prefix.length) : null;
  }
  return rawName;
}

async function postMcpAppEndpoint<T>(
  endpoint: "call-tool" | "list-tools" | "read-resource",
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    agentNativePath(`/_agent-native/mcp/apps/${endpoint}`),
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    let message = `MCP App request failed (${response.status})`;
    try {
      const json = await response.json();
      if (typeof json?.error === "string") message = json.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function errorToolResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
