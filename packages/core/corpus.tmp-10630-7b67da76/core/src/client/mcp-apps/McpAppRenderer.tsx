import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AGENT_NATIVE_EMBED_MESSAGE_TYPES,
  AGENT_NATIVE_EMBED_PROTOCOL,
  AGENT_NATIVE_EMBED_VERSION,
} from "../../embedding/protocol.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import { sendToAgentChat, type AgentChatRequestMode } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import { cn } from "../utils.js";

export const DEFAULT_MCP_APP_IFRAME_HEIGHT = 650;
export const MCP_APP_INITIALIZE_TIMEOUT_MS = 8000;
const MIN_IFRAME_HEIGHT = 220;
const VIEWPORT_MARGIN = 16;
const SANDBOX_FLAGS = "allow-scripts allow-forms allow-popups";
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface McpAppRendererProps {
  app: AgentMcpAppPayload;
  className?: string;
}

type ResourceUiMeta = {
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
  prefersBorder?: boolean;
};

type McpContentPart = {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
  url?: unknown;
};

type McpAppModelContext = {
  content?: unknown;
  structuredContent?: unknown;
};

export function McpAppRenderer({ app, className }: McpAppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const desiredHeightRef = useRef(DEFAULT_MCP_APP_IFRAME_HEIGHT);
  const modelContextRef = useRef<McpAppModelContext | null>(null);
  const readyRef = useRef(false);
  const [height, setHeight] = useState(DEFAULT_MCP_APP_IFRAME_HEIGHT);
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
  const externalOpenUrl = useMemo(() => openUrlFromMcpApp(app), [app]);

  // Keep the latest payload/permissions/csp reachable from the bridge effect
  // without making them effect dependencies. The embedded resource identity is
  // fully captured by `srcDoc`. The bridge effect must NOT re-run when a benign
  // parent re-render hands us a new `app` object reference with identical
  // content (common during chat streaming/polling): re-running tears down a
  // live, already-initialized MCP App (teardownResource) and re-arms the
  // initialize watchdog against a fresh host AppBridge that the embed shell
  // will never re-handshake (its connect promise is memoized), surfacing a
  // false "MCP App did not finish initializing." error after the app is
  // visibly working.
  const appRef = useRef(app);
  const supportedPermissionsRef = useRef(supportedPermissions);
  const uiCspRef = useRef(uiMeta.csp);
  appRef.current = app;
  supportedPermissionsRef.current = supportedPermissions;
  uiCspRef.current = uiMeta.csp;

  useEffect(() => {
    desiredHeightRef.current = DEFAULT_MCP_APP_IFRAME_HEIGHT;
    setHeight(
      clampMcpAppHeight(
        DEFAULT_MCP_APP_IFRAME_HEIGHT,
        availableMcpAppHeight(iframeRef.current),
      ),
    );
    readyRef.current = false;
    setReady(false);
    setError(null);
    modelContextRef.current = null;
  }, [srcDoc]);

  const markReady = useCallback(() => {
    readyRef.current = true;
    setReady(true);
    setError(null);
  }, []);

  const applyHeight = useCallback((desiredHeight?: number) => {
    if (
      typeof desiredHeight === "number" &&
      Number.isFinite(desiredHeight) &&
      desiredHeight > 0
    ) {
      desiredHeightRef.current = desiredHeight;
    }
    setHeight(
      clampMcpAppHeight(
        desiredHeightRef.current,
        availableMcpAppHeight(iframeRef.current),
      ),
    );
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyHeight();
      });
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update, {
      passive: true,
    });
    document.addEventListener("scroll", update, true);

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) {
      observer.observe(document.documentElement);
      const parent = iframeRef.current?.parentElement;
      if (parent) observer.observe(parent);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [applyHeight, srcDoc]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !srcDoc) return;
    const frameWindow = iframe.contentWindow;
    const listener = (event: MessageEvent) => {
      if (event.source !== frameWindow) return;
      if (isMcpAppReadyMessage(event.data)) {
        markReady();
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [markReady, srcDoc]);

  useBrowserLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !srcDoc) return;

    const currentApp = appRef.current;
    let closed = false;
    const initializeTimer = window.setTimeout(() => {
      if (closed || readyRef.current) return;
      setReady(false);
      setError("MCP App did not finish initializing.");
    }, MCP_APP_INITIALIZE_TIMEOUT_MS);
    const bridge = new AppBridge(
      null,
      { name: "Agent Native", version: "1.0.0" },
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        sandbox: {
          permissions: supportedPermissionsRef.current,
          csp: uiCspRef.current ?? {},
        },
      },
      {
        hostContext: buildHostContext(
          currentApp,
          availableMcpAppHeight(iframe),
        ) as any,
      },
    );

    bridge.addEventListener("sizechange", ({ height: nextHeight }) => {
      if (typeof nextHeight !== "number" || !Number.isFinite(nextHeight)) {
        return;
      }
      applyHeight(nextHeight);
    });
    bridge.addEventListener("initialized", () => {
      if (closed) return;
      clearTimeout(initializeTimer);
      markReady();
      void bridge.sendToolInput({ arguments: appRef.current.toolInput });
      void bridge.sendToolResult(appRef.current.toolResult as CallToolResult);
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
      const toolName = normalizeSameServerToolName(
        appRef.current.serverId,
        name,
      );
      if (!toolName) {
        return errorToolResult("Cross-server MCP App tool calls are blocked.");
      }
      try {
        return await postMcpAppEndpoint<CallToolResult>("call-tool", {
          serverId: appRef.current.serverId,
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
      postMcpAppEndpoint("list-tools", { serverId: appRef.current.serverId });
    bridge.onreadresource = async ({ uri }) =>
      postMcpAppEndpoint("read-resource", {
        serverId: appRef.current.serverId,
        uri,
      });
    bridge.onlistresources = async () => ({ resources: [] });
    bridge.onlistresourcetemplates = async () => ({ resourceTemplates: [] });
    bridge.ondownloadfile = async () => ({ isError: true });
    bridge.onmessage = async (params) => {
      const message = messageTextFromMcpUiMessage(params);
      if (!message.trim()) return { isError: true };
      const mode = requestModeFromMcpUiMessage(params);
      sendToAgentChat({
        message,
        context: contextTextFromMcpModelContext(modelContextRef.current),
        images: imageDataUrlsFromMcpContent(params.content),
        submit: true,
        openSidebar: true,
        ...(mode ? { mode } : {}),
      });
      return {};
    };
    bridge.onupdatemodelcontext = async (params) => {
      modelContextRef.current = params as McpAppModelContext;
      return {};
    };

    const transport = new PostMessageTransport(
      iframe.contentWindow,
      iframe.contentWindow,
    );
    setError(null);
    void bridge.connect(transport).catch((err: any) => {
      if (!closed) {
        clearTimeout(initializeTimer);
        setError(err?.message ?? "Failed to initialize MCP App.");
      }
    });

    return () => {
      closed = true;
      modelContextRef.current = null;
      clearTimeout(initializeTimer);
      void bridge
        .teardownResource({}, { timeout: 500 })
        .catch(() => undefined)
        .finally(() => {
          void (bridge as any).close?.().catch?.(() => undefined);
        });
    };
    // The embedded resource identity is captured by `srcDoc`; `app`,
    // `supportedPermissions`, and `uiMeta.csp` are read via refs so a
    // new-but-equal `app` object reference does not tear down a live bridge.
  }, [applyHeight, markReady, srcDoc]);

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
          {externalOpenUrl && (
            <button
              type="button"
              className="agent-mcp-app__open"
              onClick={() =>
                window.open(externalOpenUrl, "_blank", "noopener,noreferrer")
              }
            >
              Open in new tab
            </button>
          )}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={app.tool?.title ?? app.originalToolName}
        srcDoc={srcDoc}
        sandbox={SANDBOX_FLAGS}
        allow={buildAllowAttribute(supportedPermissions)}
        style={{ height }}
      />
    </div>
  );
}

function messageTextFromMcpUiMessage(params: { content?: unknown }): string {
  return textPartsFromMcpContent(params.content).join("\n\n").trim();
}

function requestModeFromMcpUiMessage(
  params: unknown,
): AgentChatRequestMode | undefined {
  const record =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as { mode?: unknown; requestMode?: unknown })
      : {};
  const mode = record.requestMode ?? record.mode;
  return mode === "act" || mode === "plan" ? mode : undefined;
}

function contextTextFromMcpModelContext(
  context: McpAppModelContext | null,
): string | undefined {
  if (!context) return undefined;
  const parts = textPartsFromMcpContent(context.content);
  if (context.structuredContent !== undefined) {
    parts.push(JSON.stringify(context.structuredContent, null, 2));
  }
  const text = parts.join("\n\n").trim();
  return text || undefined;
}

function textPartsFromMcpContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .map((part): string | null => {
      const record = contentPartRecord(part);
      if (
        !record ||
        record.type !== "text" ||
        typeof record.text !== "string"
      ) {
        return null;
      }
      const text = record.text.trim();
      return text || null;
    })
    .filter((text): text is string => Boolean(text));
}

function imageDataUrlsFromMcpContent(content: unknown): string[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images = content
    .map((part): string | null => {
      const record = contentPartRecord(part);
      if (!record || record.type !== "image") return null;
      if (typeof record.url === "string" && record.url.trim()) {
        return record.url;
      }
      if (typeof record.data !== "string" || !record.data.trim()) return null;
      const mimeType =
        typeof record.mimeType === "string" &&
        record.mimeType.startsWith("image/")
          ? record.mimeType
          : "image/png";
      return `data:${mimeType};base64,${record.data}`;
    })
    .filter((image): image is string => Boolean(image));
  return images.length ? images : undefined;
}

function contentPartRecord(part: unknown): McpContentPart | null {
  return part && typeof part === "object" && !Array.isArray(part)
    ? (part as McpContentPart)
    : null;
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function openUrlRecordValue(value: unknown): string | null {
  const record = recordValue(value);
  const webUrl = record?.webUrl;
  return typeof webUrl === "string" && isSafeExternalUrl(webUrl)
    ? webUrl
    : null;
}

function openUrlFromMcpApp(app: AgentMcpAppPayload): string | null {
  const result = recordValue(app.toolResult);
  const meta = recordValue(result?._meta);
  const fromMeta = openUrlRecordValue(meta?.["agent-native/openLink"]);
  if (fromMeta) return fromMeta;

  const structuredContent = recordValue(result?.structuredContent);
  const fromStructured = openUrlRecordValue(structuredContent?.openLink);
  if (fromStructured) return fromStructured;

  const directUrl = structuredContent?.url ?? result?.url;
  return typeof directUrl === "string" && isSafeExternalUrl(directUrl)
    ? directUrl
    : null;
}

export function supportedMcpAppPermissions(
  permissions: McpUiResourcePermissions | undefined,
): McpUiResourcePermissions {
  return permissions?.clipboardWrite ? { clipboardWrite: {} } : {};
}

export function isMcpAppReadyMessage(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as {
    protocol?: unknown;
    version?: unknown;
    type?: unknown;
  };
  if (
    record.protocol === AGENT_NATIVE_EMBED_PROTOCOL &&
    record.version === AGENT_NATIVE_EMBED_VERSION &&
    record.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.READY
  ) {
    return true;
  }
  const type = record.type;
  return (
    type === "agentNative.embeddedAppReady" ||
    type === "agentNative.frameOrigin"
  );
}

export function buildMcpAppCsp(csp: McpUiResourceCsp | undefined): string {
  const connect = withLocalWebSocketSources(
    sanitizeCspSources(csp?.connectDomains),
  );
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

function withLocalWebSocketSources(sources: string[]): string[] {
  const out = [...sources];
  for (const source of sources) {
    try {
      const url = new URL(source);
      if (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      ) {
        out.push(`ws://${url.host}`);
      }
    } catch {
      // Ignore non-URL CSP source expressions.
    }
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

function buildHostContext(app: AgentMcpAppPayload, maxHeight: number) {
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
      maxHeight,
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

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function availableMcpAppHeight(
  element: HTMLElement | null | undefined,
): number {
  if (typeof window === "undefined") return DEFAULT_MCP_APP_IFRAME_HEIGHT;

  const viewportHeight =
    finitePositiveNumber(window.visualViewport?.height) ??
    finitePositiveNumber(window.innerHeight) ??
    DEFAULT_MCP_APP_IFRAME_HEIGHT;

  if (!element) {
    return Math.max(1, Math.floor(viewportHeight - VIEWPORT_MARGIN * 2));
  }

  const rect = element.getBoundingClientRect();
  const top = Number.isFinite(rect.top)
    ? Math.max(VIEWPORT_MARGIN, rect.top)
    : VIEWPORT_MARGIN;
  return Math.max(1, Math.floor(viewportHeight - top - VIEWPORT_MARGIN));
}

export function clampMcpAppHeight(
  desiredHeight: number,
  maxVisibleHeight: number,
): number {
  const maxHeight =
    finitePositiveNumber(maxVisibleHeight) ?? DEFAULT_MCP_APP_IFRAME_HEIGHT;
  const desired =
    finitePositiveNumber(desiredHeight) ?? DEFAULT_MCP_APP_IFRAME_HEIGHT;
  const minimum = Math.min(MIN_IFRAME_HEIGHT, maxHeight);
  return Math.max(minimum, Math.min(maxHeight, Math.ceil(desired)));
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
