import { useEffect, useMemo, useRef, useState } from "react";

import { buildExtensionHtml } from "../../extensions/html-shell.js";
import { getThemeVars } from "../../extensions/theme.js";
import { sendToAgentChat } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import {
  isAllowedExtensionPath,
  sanitizeExtensionRequestOptions,
  checkBridgePolicy,
  type BridgePolicyContext,
  type ExtensionBridgeRole,
} from "./iframe-bridge.js";
import { normalizeAgentNativeExtensionSandbox } from "./portable-extension.js";

const THEME_CSS_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--radius",
  "--sidebar-background",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
];

const EXTENSION_IFRAME_SANDBOX =
  normalizeAgentNativeExtensionSandbox(undefined);

interface InlineExtensionSource {
  mode?: "database" | "local-files";
  permissions?: BridgePolicyContext["permissions"];
}

export interface InlineExtensionDefinition {
  id: string;
  name: string;
  description?: string;
  content?: string;
  updatedAt?: string;
  mode?: "transient" | "persisted";
  source?: InlineExtensionSource;
}

export interface InlineExtensionFrameProps {
  extensionId?: string;
  extension?: InlineExtensionDefinition;
  slotId?: string;
  context?: Record<string, unknown> | null;
  className?: string;
  initialHeight?: number;
}

function getParentThemeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_CSS_VARS) {
    const val = computed.getPropertyValue(name).trim();
    if (val) vars[name] = val;
  }
  return vars;
}

function normalizeRole(value: unknown): ExtensionBridgeRole {
  return value === "owner" ||
    value === "admin" ||
    value === "editor" ||
    value === "viewer"
    ? value
    : "viewer";
}

function serializeChatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function transientDataKey(
  extensionId: string,
  collection: string,
  scope: string,
): string {
  return `agent-native:inline-extension-data:${extensionId}:${scope}:${collection}`;
}

interface TransientDataRow {
  id: string;
  extensionId: string;
  toolId: string;
  collection: string;
  data: string;
  ownerEmail: string;
  scope: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
}

function readTransientRows(
  extensionId: string,
  collection: string,
  scope: string,
): TransientDataRow[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(transientDataKey(extensionId, collection, scope)) ??
        "[]",
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTransientRows(
  extensionId: string,
  collection: string,
  scope: string,
  rows: TransientDataRow[],
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    transientDataKey(extensionId, collection, scope),
    JSON.stringify(rows),
  );
}

function parseTransientDataPath(
  extensionId: string,
  path: string,
): { collection: string; itemId?: string; scope: string } | null {
  try {
    const url = new URL(path, "http://agent-native.local");
    const parts = url.pathname.split("/");
    if (
      parts.length < 6 ||
      parts.length > 7 ||
      parts[1] !== "_agent-native" ||
      parts[2] !== "extensions" ||
      parts[3] !== "data" ||
      decodeURIComponent(parts[4]) !== extensionId
    ) {
      return null;
    }
    return {
      collection: decodeURIComponent(parts[5] ?? ""),
      itemId: parts[6] ? decodeURIComponent(parts[6]) : undefined,
      scope: url.searchParams.get("scope") || "user",
    };
  } catch {
    return null;
  }
}

async function handleTransientExtensionData(
  extensionId: string,
  path: string,
  options: RequestInit,
): Promise<Record<string, unknown> | null> {
  const parsed = parseTransientDataPath(extensionId, path);
  if (!parsed?.collection) return null;

  const method = String(options.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    const rows = readTransientRows(
      extensionId,
      parsed.collection,
      parsed.scope,
    );
    return {
      response: {
        ok: true,
        status: 200,
        statusText: "OK",
        body: rows,
      },
    };
  }

  if (method === "POST") {
    const bodyText = typeof options.body === "string" ? options.body : "{}";
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = {};
    }
    if (body.data === undefined) {
      return {
        response: {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          body: { error: "data is required" },
        },
      };
    }
    const itemId =
      typeof body.id === "string" && body.id.trim()
        ? body.id.trim()
        : `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const requestedScope =
      body.scope === "org" || parsed.scope === "org" ? "org" : "user";
    const now = new Date().toISOString();
    const rows = readTransientRows(
      extensionId,
      parsed.collection,
      requestedScope,
    );
    const existing = rows.find((row) => row.id === itemId);
    const row: TransientDataRow = {
      id: itemId,
      extensionId,
      toolId: extensionId,
      collection: parsed.collection,
      data:
        typeof body.data === "string" ? body.data : JSON.stringify(body.data),
      ownerEmail: "",
      scope: requestedScope,
      orgId: requestedScope === "org" ? "inline" : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    writeTransientRows(extensionId, parsed.collection, requestedScope, [
      row,
      ...rows.filter((item) => item.id !== itemId),
    ]);
    return {
      response: {
        ok: true,
        status: 200,
        statusText: "OK",
        body: row,
      },
    };
  }

  if (method === "DELETE" && parsed.itemId) {
    const rows = readTransientRows(
      extensionId,
      parsed.collection,
      parsed.scope,
    );
    writeTransientRows(
      extensionId,
      parsed.collection,
      parsed.scope,
      rows.filter((row) => row.id !== parsed.itemId),
    );
    return {
      response: {
        ok: true,
        status: 200,
        statusText: "OK",
        body: { ok: true },
      },
    };
  }

  return {
    response: {
      ok: false,
      status: 405,
      statusText: "Method Not Allowed",
      body: { error: "Unsupported transient extensionData request" },
    },
  };
}

function buildTransientSrcDoc(
  extension: InlineExtensionDefinition,
  isDark: boolean,
): string {
  return buildExtensionHtml(
    extension.content ?? "",
    getThemeVars(isDark),
    isDark,
    extension.id,
    {
      authorEmail: "",
      viewerEmail: "",
      isAuthor: true,
      role: "owner",
    },
  );
}

export function InlineExtensionFrame({
  extensionId,
  extension: providedExtension,
  slotId = "agent-chat.inline",
  context,
  className,
  initialHeight = 260,
}: InlineExtensionFrameProps) {
  const providedId = providedExtension?.id ?? extensionId ?? "";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(initialHeight);
  const [isDark, setIsDark] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.classList.contains("dark"),
  );
  const bridgeContextRef = useRef<BridgePolicyContext>({
    role: providedExtension?.content ? "owner" : "viewer",
    isAuthor: !!providedExtension?.content,
  });
  const bindingLatchedRef = useRef(false);
  const [fetchedExtension, setFetchedExtension] =
    useState<InlineExtensionDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
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

  useEffect(() => {
    if (!providedId || providedExtension) {
      setFetchedExtension(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetch(agentNativePath(`/_agent-native/extensions/${providedId}`))
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as InlineExtensionDefinition;
      })
      .then((row) => {
        if (!cancelled) setFetchedExtension(row);
      })
      .catch(() => {
        if (!cancelled) setFetchedExtension(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providedExtension, providedId]);

  const extension = providedExtension ?? fetchedExtension ?? null;
  const resolvedId = extension?.id ?? providedId;
  const isTransient =
    extension?.mode === "transient" ||
    (!!extension?.content && !extensionId && extension?.mode !== "persisted");

  const initialDarkRef = useRef(isDark);
  const iframeSrc = useMemo(() => {
    if (!resolvedId || isTransient) return undefined;
    const v = encodeURIComponent(extension?.updatedAt ?? "");
    return agentNativePath(
      `/_agent-native/extensions/${resolvedId}/render?slot=${encodeURIComponent(slotId)}&dark=${initialDarkRef.current}&v=${v}`,
    );
  }, [extension?.updatedAt, isTransient, resolvedId, slotId]);

  const srcDoc = useMemo(() => {
    if (!extension || !isTransient) return undefined;
    return buildTransientSrcDoc(extension, initialDarkRef.current);
  }, [extension, isTransient]);

  useEffect(() => {
    bridgeContextRef.current = isTransient
      ? { role: "owner", isAuthor: true }
      : { role: "viewer", isAuthor: false };
    bindingLatchedRef.current = false;
    setHeight(initialHeight);
  }, [initialHeight, isTransient, resolvedId, extension?.updatedAt]);

  const sendThemeToIframe = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "agent-native-theme-update",
        isDark,
        vars: getParentThemeVars(),
      },
      "*",
    );
  };

  useEffect(() => {
    sendThemeToIframe();
  }, [isDark, srcDoc, iframeSrc]);

  const contextJson = JSON.stringify(context ?? {});
  const sendContextToIframe = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { type: "agent-native-slot-context", context: context ?? {} },
      "*",
    );
  };

  useEffect(() => {
    sendContextToIframe();
  }, [contextJson, srcDoc, iframeSrc]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "agent-native-extension-binding") {
        if (bindingLatchedRef.current) return;
        bindingLatchedRef.current = true;
        const binding = (message as any).binding ?? {};
        const role = normalizeRole(binding.role);
        bridgeContextRef.current = {
          role,
          isAuthor: !!binding.isAuthor,
          source: binding.source === "local-files" ? "local-files" : "database",
          permissions:
            binding && typeof binding.permissions === "object"
              ? binding.permissions
              : undefined,
        };
        return;
      }

      if (message.type === "agent-native-extension-resize") {
        const h = Number((message as any).height);
        if (Number.isFinite(h) && h > 0) {
          setHeight(Math.ceil(Math.min(Math.max(h, 96), 1000)));
        }
        return;
      }

      if (message.type === "agent-native-extension-keydown") {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: (message as any).key,
            code: (message as any).code,
            metaKey: !!(message as any).metaKey,
            ctrlKey: !!(message as any).ctrlKey,
            shiftKey: !!(message as any).shiftKey,
            altKey: !!(message as any).altKey,
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }

      if (message.type === "agent-native-send-to-chat") {
        const text = serializeChatValue((message as any).message);
        if (!text?.trim()) return;
        sendToAgentChat({
          message: text,
          context: serializeChatValue((message as any).context),
          submit: (message as any).submit !== false,
          openSidebar: (message as any).openSidebar !== false,
        });
        return;
      }

      if (message.type === "agent-native-ui-output") {
        window.dispatchEvent(
          new CustomEvent("agentNative.inlineUiOutput", {
            detail: {
              extensionId: resolvedId,
              key:
                typeof (message as any).key === "string"
                  ? (message as any).key
                  : undefined,
              value: (message as any).value,
              output: (message as any).output,
            },
          }),
        );
        return;
      }

      if (message.type === "agent-native-extension-error-fix") {
        const errors: string[] = Array.isArray((message as any).errors)
          ? (message as any).errors
          : [];
        sendToAgentChat({
          message: `Fix runtime errors in the inline extension "${extension?.name ?? resolvedId}".\n\nErrors:\n${errors.join("\n")}`,
          context: [
            `The user is viewing an inline generated extension named "${extension?.name ?? resolvedId}".`,
            isTransient
              ? "This is a transient chat-only extension. Re-render it with render-inline-extension instead of update-extension."
              : `This is saved as extension id ${resolvedId}. Use get-extension/update-extension for durable edits.`,
            extension?.content
              ? `\nCurrent inline content:\n\`\`\`html\n${extension.content}\n\`\`\``
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          submit: true,
          openSidebar: true,
        });
        return;
      }

      if (message.type !== "agent-native-extension-request") return;

      const requestId = String((message as any).requestId ?? "");
      const path = String((message as any).path ?? "");
      const respond = (payload: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "agent-native-extension-response",
            requestId,
            ...payload,
          },
          "*",
        );
      };

      if (
        !requestId ||
        !resolvedId ||
        !isAllowedExtensionPath(path, resolvedId)
      ) {
        respond({ error: "Extension request path is not allowed" });
        return;
      }

      try {
        const options = sanitizeExtensionRequestOptions(
          (message as any).options,
        );
        const policy = checkBridgePolicy(path, options.method ?? "GET", {
          ...bridgeContextRef.current,
          extensionId: resolvedId,
        });
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

        if (isTransient) {
          const localData = await handleTransientExtensionData(
            resolvedId,
            path,
            options,
          );
          if (localData) {
            respond(localData);
            return;
          }
        }

        const finalHeaders = new Headers(options.headers ?? undefined);
        finalHeaders.set("X-Agent-Native-Extension-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Extension-Id", resolvedId);
        finalHeaders.set("X-Agent-Native-Tool-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Tool-Id", resolvedId);
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
        respond({ error: err?.message ?? "Extension host request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [extension, isTransient, resolvedId]);

  if (!extension) {
    if (!isLoading) return null;
    return (
      <div
        className={className}
        style={{ height: initialHeight }}
        aria-busy="true"
      />
    );
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <iframe
        ref={iframeRef}
        key={`${resolvedId}-${extension.updatedAt ?? "inline"}-${isTransient ? "transient" : "persisted"}`}
        src={iframeSrc}
        srcDoc={srcDoc}
        title={extension.name}
        sandbox={EXTENSION_IFRAME_SANDBOX}
        style={{ width: "100%", border: 0, height, display: "block" }}
        onLoad={() => {
          sendThemeToIframe();
          sendContextToIframe();
        }}
      />
    </div>
  );
}
