import { EXTENSION_IFRAME_META_CSP } from "../../extensions/html-shell.js";

export const AGENT_NATIVE_EXTENSION_STORAGE_MESSAGE_TYPES = {
  REQUEST: "agentNative.extension.storage",
  RESPONSE: "agentNative.extension.storageResult",
  SLOT_CONTEXT: "agentNative.extension.slotContext",
  RESIZE: "agentNative.extension.resize",
} as const;

export type AgentNativeExtensionStorageScope = "user" | "org";

export type AgentNativeExtensionStorageOperation =
  | "list"
  | "get"
  | "set"
  | "remove";

export interface AgentNativeExtensionDefinition {
  id: string;
  name: string;
  description?: string;
  content: string;
  updatedAt?: string;
}

export interface AgentNativeExtensionStorageRequest {
  operation: AgentNativeExtensionStorageOperation;
  extensionId: string;
  collection: string;
  id?: string;
  data?: unknown;
  scope?: AgentNativeExtensionStorageScope;
  limit?: number;
}

export interface AgentNativeExtensionStorageContext {
  extensionId: string;
  slotId?: string;
  slotContext?: Record<string, unknown> | null;
}

export interface AgentNativeExtensionDataRow {
  id: string;
  extensionId: string;
  collection: string;
  data: unknown;
  scope: AgentNativeExtensionStorageScope;
  createdAt: string;
  updatedAt: string;
}

export interface AgentNativeExtensionStorage {
  list(
    collection: string,
    options: {
      scope?: AgentNativeExtensionStorageScope | "all";
      limit?: number;
      context: AgentNativeExtensionStorageContext;
    },
  ): Promise<AgentNativeExtensionDataRow[]>;
  get(
    collection: string,
    id: string,
    options: {
      scope?: AgentNativeExtensionStorageScope;
      context: AgentNativeExtensionStorageContext;
    },
  ): Promise<AgentNativeExtensionDataRow | null>;
  set(
    collection: string,
    id: string,
    data: unknown,
    options: {
      scope?: AgentNativeExtensionStorageScope;
      context: AgentNativeExtensionStorageContext;
    },
  ): Promise<AgentNativeExtensionDataRow>;
  remove(
    collection: string,
    id: string,
    options: {
      scope?: AgentNativeExtensionStorageScope;
      context: AgentNativeExtensionStorageContext;
    },
  ): Promise<{ ok: true }>;
}

export interface BuildAgentNativeExtensionHtmlOptions {
  extensionId: string;
  content: string;
  title?: string;
  dark?: boolean;
  themeCss?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const defaultThemeCss = `
:root {
  color-scheme: light;
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --border: 214.3 31.8% 91.4%;
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
}
.dark {
  color-scheme: dark;
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --border: 217.2 32.6% 17.5%;
  --primary: 217.2 91.2% 59.8%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 91% 71%;
  --destructive-foreground: 210 40% 98%;
}
html, body {
  margin: 0;
  min-height: 100%;
  background: transparent;
  color: hsl(var(--foreground));
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body {
  padding: 0;
}
`;

export function buildAgentNativeExtensionHtml(
  options: BuildAgentNativeExtensionHtmlOptions,
): string {
  const extensionId = safeJson(options.extensionId);
  const storageRequestType = safeJson(
    AGENT_NATIVE_EXTENSION_STORAGE_MESSAGE_TYPES.REQUEST,
  );
  const storageResponseType = safeJson(
    AGENT_NATIVE_EXTENSION_STORAGE_MESSAGE_TYPES.RESPONSE,
  );
  const slotContextType = safeJson(
    AGENT_NATIVE_EXTENSION_STORAGE_MESSAGE_TYPES.SLOT_CONTEXT,
  );
  const resizeType = safeJson(
    AGENT_NATIVE_EXTENSION_STORAGE_MESSAGE_TYPES.RESIZE,
  );
  const themeCss = `${defaultThemeCss}\n${options.themeCss ?? ""}`;

  return `<!doctype html>
<html lang="en"${options.dark ? ' class="dark"' : ""}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${EXTENSION_IFRAME_META_CSP}" />
  <title>${escapeHtml(options.title ?? "Agent Native extension")}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap" rel="stylesheet" />
  <script
    src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4"
    integrity="sha384-yNSZBFvuOWcmww494a9+1zNuvgUGEXoWkein7cxP8wHUTi3iXCU4vJ7hr3tzBCml"
    crossorigin="anonymous"
  ></script>
  <script
    defer
    src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
    integrity="sha384-WPtu0YHhJ3arcykfnv1JgUffWDSKRnqnDeTpJUbOc2os2moEmLkIdaeR0trPN4be"
    crossorigin="anonymous"
  ></script>
  <style>${themeCss}</style>
  <style type="text/tailwindcss">
    @custom-variant dark (&:where(.dark, .dark *));
    @theme {
      --color-background: hsl(var(--background));
      --color-foreground: hsl(var(--foreground));
      --color-muted: hsl(var(--muted));
      --color-muted-foreground: hsl(var(--muted-foreground));
      --color-border: hsl(var(--border));
      --color-primary: hsl(var(--primary));
      --color-primary-foreground: hsl(var(--primary-foreground));
      --color-destructive: hsl(var(--destructive));
      --color-destructive-foreground: hsl(var(--destructive-foreground));
    }
  </style>
  <script>
    (function() {
      var extensionId = ${extensionId};
      var pending = {};
      var seq = 0;
      var slotContext = {};
      var HOST = {
        READY: "agentNative.host.ready",
        GET_CONTEXT: "agentNative.host.getContext",
        CONTEXT: "agentNative.host.context",
        LIST_ACTIONS: "agentNative.host.listActions",
        ACTIONS: "agentNative.host.actions",
        RUN_ACTION: "agentNative.host.runAction",
        ACTION_RESULT: "agentNative.host.actionResult",
        COMMAND: "agentNative.host.command",
        COMMAND_RESULT: "agentNative.host.commandResult"
      };
      var STORAGE_REQUEST = ${storageRequestType};
      var STORAGE_RESPONSE = ${storageResponseType};
      var SLOT_CONTEXT = ${slotContextType};
      var RESIZE = ${resizeType};

      function nextId(prefix) {
        seq += 1;
        return prefix + "-" + Date.now() + "-" + seq;
      }

      function request(type, responseType, payload, timeoutMs) {
        return new Promise(function(resolve, reject) {
          var requestId = nextId("extension");
          var timer = setTimeout(function() {
            delete pending[requestId];
            reject(new Error("Extension host request timed out"));
          }, timeoutMs || 30000);
          pending[requestId] = {
            responseType: responseType,
            resolve: resolve,
            reject: reject,
            timer: timer
          };
          window.parent.postMessage(Object.assign({ type: type, requestId: requestId }, payload || {}), "*");
        });
      }

      window.addEventListener("message", function(event) {
        if (event.source !== window.parent) return;
        var message = event.data || {};
        if (message.type === SLOT_CONTEXT) {
          slotContext = message.context || {};
          window.slotContext = slotContext;
          window.agentNative.slotContext = slotContext;
          return;
        }
        var item = pending[message.requestId];
        if (!item || message.type !== item.responseType) return;
        clearTimeout(item.timer);
        delete pending[message.requestId];
        if (message.ok === false || message.error) {
          item.reject(new Error(message.error || "Extension host request failed"));
          return;
        }
        item.resolve(message);
      });

      function storage(operation, payload) {
        return request(STORAGE_REQUEST, STORAGE_RESPONSE, Object.assign({
          operation: operation,
          extensionId: extensionId
        }, payload || {})).then(function(message) {
          return message.result;
        });
      }

      var api = {
        extensionId: extensionId,
        slotContext: slotContext,
        context: function() {
          return request(HOST.GET_CONTEXT, HOST.CONTEXT).then(function(message) {
            return message.context || {};
          });
        },
        listActions: function() {
          return request(HOST.LIST_ACTIONS, HOST.ACTIONS).then(function(message) {
            return message.actions || [];
          });
        },
        action: function(name, args) {
          return request(HOST.RUN_ACTION, HOST.ACTION_RESULT, {
            name: name,
            args: args || {}
          }).then(function(message) {
            return message.result;
          });
        },
        command: function(command, payload) {
          return request(HOST.COMMAND, HOST.COMMAND_RESULT, {
            command: command,
            payload: payload
          }).then(function(message) {
            return message.result;
          });
        },
        refresh: function(payload) {
          return api.command("refreshData", payload);
        },
        data: {
          list: function(collection, opts) {
            opts = opts || {};
            return storage("list", {
              collection: collection,
              scope: opts.scope,
              limit: opts.limit
            });
          },
          get: function(collection, id, opts) {
            opts = opts || {};
            return storage("get", {
              collection: collection,
              id: id,
              scope: opts.scope
            });
          },
          set: function(collection, id, data, opts) {
            opts = opts || {};
            return storage("set", {
              collection: collection,
              id: id,
              data: data,
              scope: opts.scope
            });
          },
          remove: function(collection, id, opts) {
            opts = opts || {};
            return storage("remove", {
              collection: collection,
              id: id,
              scope: opts.scope
            });
          }
        }
      };

      window.agentNative = api;
      window.appAction = api.action;
      window.extensionData = api.data;
      window.extensionId = extensionId;
      window.slotContext = slotContext;
      window.toolData = api.data;
      window.toolId = extensionId;

      function reportSize() {
        var height = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        window.parent.postMessage({ type: RESIZE, height: height }, "*");
      }
      if (typeof ResizeObserver !== "undefined") {
        window.addEventListener("DOMContentLoaded", function() {
          var observer = new ResizeObserver(reportSize);
          observer.observe(document.body);
          reportSize();
        });
      } else {
        window.addEventListener("load", reportSize);
        setInterval(reportSize, 1000);
      }

      window.parent.postMessage({ type: HOST.READY, requestId: nextId("ready") }, "*");
    })();
  </script>
</head>
<body>
${options.content}
</body>
</html>`;
}

function storageKey(
  namespace: string,
  context: AgentNativeExtensionStorageContext,
  collection: string,
  scope: AgentNativeExtensionStorageScope,
): string {
  return [
    "agent-native-extension-data",
    namespace,
    context.extensionId,
    scope,
    collection,
  ]
    .map(encodeURIComponent)
    .join(":");
}

function readCollection(
  namespace: string,
  context: AgentNativeExtensionStorageContext,
  collection: string,
  scope: AgentNativeExtensionStorageScope,
): Record<string, AgentNativeExtensionDataRow> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(
    storageKey(namespace, context, collection, scope),
  );
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, AgentNativeExtensionDataRow>;
  } catch {
    return {};
  }
}

function writeCollection(
  namespace: string,
  context: AgentNativeExtensionStorageContext,
  collection: string,
  scope: AgentNativeExtensionStorageScope,
  rows: Record<string, AgentNativeExtensionDataRow>,
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    storageKey(namespace, context, collection, scope),
    JSON.stringify(rows),
  );
}

function normalizeScope(
  scope: AgentNativeExtensionStorageScope | undefined,
): AgentNativeExtensionStorageScope {
  return scope === "org" ? "org" : "user";
}

export function createLocalStorageAgentNativeExtensionStorage(
  namespace = "default",
): AgentNativeExtensionStorage {
  return {
    async list(collection, options) {
      const scopes =
        options.scope === "all"
          ? (["user", "org"] as const)
          : ([normalizeScope(options.scope)] as const);
      const rows = scopes.flatMap((scope) =>
        Object.values(
          readCollection(namespace, options.context, collection, scope),
        ),
      );
      return rows
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, options.limit ?? 100);
    },
    async get(collection, id, options) {
      const scope = normalizeScope(options.scope);
      const rows = readCollection(
        namespace,
        options.context,
        collection,
        scope,
      );
      return rows[id] ?? null;
    },
    async set(collection, id, data, options) {
      const scope = normalizeScope(options.scope);
      const rows = readCollection(
        namespace,
        options.context,
        collection,
        scope,
      );
      const now = new Date().toISOString();
      const row: AgentNativeExtensionDataRow = {
        id,
        extensionId: options.context.extensionId,
        collection,
        data,
        scope,
        createdAt: rows[id]?.createdAt ?? now,
        updatedAt: now,
      };
      rows[id] = row;
      writeCollection(namespace, options.context, collection, scope, rows);
      return row;
    },
    async remove(collection, id, options) {
      const scope = normalizeScope(options.scope);
      const rows = readCollection(
        namespace,
        options.context,
        collection,
        scope,
      );
      delete rows[id];
      writeCollection(namespace, options.context, collection, scope, rows);
      return { ok: true };
    },
  };
}
