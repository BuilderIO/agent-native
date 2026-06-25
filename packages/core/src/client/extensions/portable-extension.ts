import { EXTENSION_IFRAME_META_CSP } from "../../extensions/html-shell.js";
import { AGENT_NATIVE_HOST_MESSAGE_TYPES } from "../host-bridge.js";

export const AGENT_NATIVE_EXTENSION_MESSAGE_TYPES = {
  STORAGE_REQUEST: "agentNative.extension.storage",
  STORAGE_RESPONSE: "agentNative.extension.storageResult",
  RESIZE: "agentNative.extension.resize",
  SLOT_CONTEXT: "agentNative.extension.slotContext",
} as const;

export type AgentNativeExtensionMessageType =
  (typeof AGENT_NATIVE_EXTENSION_MESSAGE_TYPES)[keyof typeof AGENT_NATIVE_EXTENSION_MESSAGE_TYPES];

export type AgentNativeExtensionStorageScope = "user" | "org" | "all" | string;

export interface AgentNativeExtensionManifest {
  /** Slot IDs this extension may render into. Omit to let the host decide. */
  slots?: readonly string[];
  /** Host action names this extension is allowed to call. Omit to inherit the slot policy. */
  requestedActions?: readonly string[];
  /** Host command names this extension is allowed to call. Omit to inherit the slot policy. */
  requestedCommands?: readonly string[];
  /** Storage scopes this extension is allowed to use. Omit to inherit the slot policy. */
  storageScopes?: readonly AgentNativeExtensionStorageScope[];
}

export interface AgentNativeExtensionDefinition {
  id: string;
  name: string;
  content: string;
  description?: string;
  updatedAt?: string;
  manifest?: AgentNativeExtensionManifest;
  slots?: readonly string[];
  requestedActions?: readonly string[];
  requestedCommands?: readonly string[];
  storageScopes?: readonly AgentNativeExtensionStorageScope[];
  [key: string]: unknown;
}

export interface AgentNativeExtensionStorageOptions {
  scope?: AgentNativeExtensionStorageScope;
  limit?: number;
  [key: string]: unknown;
}

export interface AgentNativeExtensionStorageContext {
  extensionId: string;
  slotId?: string;
  scope?: Exclude<AgentNativeExtensionStorageScope, "all"> | string;
  userId?: string;
  organizationId?: string;
  [key: string]: unknown;
}

export interface AgentNativeExtensionStorageRow<TData = unknown> {
  id: string;
  extensionId: string;
  collection: string;
  data: TData;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentNativeExtensionStorage {
  list(
    collection: string,
    options: AgentNativeExtensionStorageOptions | undefined,
    context: AgentNativeExtensionStorageContext,
  ):
    | AgentNativeExtensionStorageRow[]
    | Promise<AgentNativeExtensionStorageRow[]>;
  get(
    collection: string,
    id: string,
    options: AgentNativeExtensionStorageOptions | undefined,
    context: AgentNativeExtensionStorageContext,
  ):
    | AgentNativeExtensionStorageRow
    | null
    | Promise<AgentNativeExtensionStorageRow | null>;
  set(
    collection: string,
    id: string,
    data: unknown,
    options: AgentNativeExtensionStorageOptions | undefined,
    context: AgentNativeExtensionStorageContext,
  ): AgentNativeExtensionStorageRow | Promise<AgentNativeExtensionStorageRow>;
  remove(
    collection: string,
    id: string,
    options: AgentNativeExtensionStorageOptions | undefined,
    context: AgentNativeExtensionStorageContext,
  ): { removed: boolean } | Promise<{ removed: boolean }>;
}

export interface CreateHttpAgentNativeExtensionStorageOptions {
  /** Endpoint that receives storage operation POSTs. */
  endpoint: string;
  fetch?: typeof fetch;
  headers?:
    | HeadersInit
    | ((
        context: AgentNativeExtensionStorageContext,
      ) => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
}

export interface BuildAgentNativeExtensionHtmlOptions {
  extensionId: string;
  content: string;
  title?: string;
  slotId?: string;
  slotContext?: Record<string, unknown> | null;
  themeCss?: string;
  isDark?: boolean;
}

function firstList<T>(
  ...values: Array<readonly T[] | undefined>
): readonly T[] | undefined {
  return values.find((value) => Array.isArray(value));
}

export function getAgentNativeExtensionManifest(
  extension: AgentNativeExtensionDefinition,
): AgentNativeExtensionManifest {
  return {
    slots: firstList(extension.manifest?.slots, extension.slots),
    requestedActions: firstList(
      extension.manifest?.requestedActions,
      extension.requestedActions,
    ),
    requestedCommands: firstList(
      extension.manifest?.requestedCommands,
      extension.requestedCommands,
    ),
    storageScopes: firstList(
      extension.manifest?.storageScopes,
      extension.storageScopes,
    ),
  };
}

export function isAgentNativeExtensionAllowedInSlot(
  extension: AgentNativeExtensionDefinition,
  slotId: string | undefined,
): boolean {
  if (!slotId) return true;
  const slots = getAgentNativeExtensionManifest(extension).slots;
  if (!slots) return true;
  return slots.includes(slotId);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json.replace(/</g, "\\u003c") : "null";
  } catch {
    return "null";
  }
}

function encodedSegment(value: string): string {
  return encodeURIComponent(value);
}

function storageScope(
  options: AgentNativeExtensionStorageOptions | undefined,
  context: AgentNativeExtensionStorageContext,
): string {
  const scope = options?.scope ?? context.scope ?? "user";
  return typeof scope === "string" && scope ? scope : "user";
}

function localStorageRef(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("Extension localStorage is not available");
  }
  return window.localStorage;
}

function bucketKey(
  namespace: string,
  extensionId: string,
  scope: string,
  collection: string,
): string {
  return [
    "agent-native",
    "extension-data",
    encodedSegment(namespace),
    encodedSegment(extensionId),
    encodedSegment(scope),
    encodedSegment(collection),
  ].join(":");
}

function readBucket(
  storage: Storage,
  key: string,
): Record<string, AgentNativeExtensionStorageRow> {
  const raw = storage.getItem(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, AgentNativeExtensionStorageRow>)
      : {};
  } catch {
    return {};
  }
}

function writeBucket(
  storage: Storage,
  key: string,
  value: Record<string, AgentNativeExtensionStorageRow>,
) {
  storage.setItem(key, JSON.stringify(value));
}

function listLocalStorageBuckets(
  storage: Storage,
  namespace: string,
  extensionId: string,
  collection: string,
): string[] {
  const prefix = [
    "agent-native",
    "extension-data",
    encodedSegment(namespace),
    encodedSegment(extensionId),
    "",
  ].join(":");
  const suffix = `:${encodedSegment(collection)}`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && key.endsWith(suffix)) keys.push(key);
  }
  return keys;
}

export function createLocalStorageAgentNativeExtensionStorage(
  namespace = "default",
): AgentNativeExtensionStorage {
  return {
    list(collection, options, context) {
      const storage = localStorageRef();
      const scope = storageScope(options, context);
      const keys =
        scope === "all"
          ? listLocalStorageBuckets(
              storage,
              namespace,
              context.extensionId,
              collection,
            )
          : [bucketKey(namespace, context.extensionId, scope, collection)];
      const rows = keys.flatMap((key) =>
        Object.values(readBucket(storage, key)),
      );
      const limit = options?.limit ?? 100;
      return rows
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.max(0, limit));
    },
    get(collection, id, options, context) {
      const rows = this.list(collection, options, context);
      if (rows instanceof Promise) {
        return rows.then(
          (resolved) => resolved.find((row) => row.id === id) ?? null,
        );
      }
      return rows.find((row) => row.id === id) ?? null;
    },
    set(collection, id, data, options, context) {
      const storage = localStorageRef();
      const scope = storageScope(options, context);
      if (scope === "all") {
        throw new Error('Extension data writes cannot use scope "all"');
      }
      const key = bucketKey(namespace, context.extensionId, scope, collection);
      const bucket = readBucket(storage, key);
      const now = new Date().toISOString();
      const row: AgentNativeExtensionStorageRow = {
        id,
        extensionId: context.extensionId,
        collection,
        data,
        scope,
        createdAt: bucket[id]?.createdAt ?? now,
        updatedAt: now,
      };
      bucket[id] = row;
      writeBucket(storage, key, bucket);
      return row;
    },
    remove(collection, id, options, context) {
      const storage = localStorageRef();
      const scope = storageScope(options, context);
      if (scope === "all") {
        throw new Error('Extension data deletes cannot use scope "all"');
      }
      const key = bucketKey(namespace, context.extensionId, scope, collection);
      const bucket = readBucket(storage, key);
      const removed = Boolean(bucket[id]);
      delete bucket[id];
      writeBucket(storage, key, bucket);
      return { removed };
    },
  };
}

async function resolveHttpStorageHeaders(
  headers: CreateHttpAgentNativeExtensionStorageOptions["headers"],
  context: AgentNativeExtensionStorageContext,
): Promise<HeadersInit | undefined> {
  return typeof headers === "function" ? headers(context) : headers;
}

async function readHttpStorageResponse<TResult>(
  response: Response,
): Promise<TResult> {
  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Extension storage request failed: ${response.status}`;
    throw new Error(message);
  }

  if (body && typeof body === "object" && "result" in body) {
    return (body as { result: TResult }).result;
  }
  return body as TResult;
}

export function createHttpAgentNativeExtensionStorage({
  endpoint,
  fetch: fetchImpl,
  headers,
  credentials = "same-origin",
}: CreateHttpAgentNativeExtensionStorageOptions): AgentNativeExtensionStorage {
  const run = async <TResult>(
    operation: "list" | "get" | "set" | "remove",
    collection: string,
    context: AgentNativeExtensionStorageContext,
    options?: AgentNativeExtensionStorageOptions,
    id?: string,
    data?: unknown,
  ): Promise<TResult> => {
    const requestFetch = fetchImpl ?? fetch;
    if (typeof requestFetch !== "function") {
      throw new Error("fetch is not available for extension storage");
    }
    const resolvedHeaders = new Headers(
      await resolveHttpStorageHeaders(headers, context),
    );
    resolvedHeaders.set("Content-Type", "application/json");

    const response = await requestFetch(endpoint, {
      method: "POST",
      credentials,
      headers: resolvedHeaders,
      body: JSON.stringify({
        operation,
        extensionId: context.extensionId,
        slotId: context.slotId,
        collection,
        id,
        data,
        options: options ?? {},
        context,
      }),
    });
    return readHttpStorageResponse<TResult>(response);
  };

  return {
    list(collection, options, context) {
      return run<AgentNativeExtensionStorageRow[]>(
        "list",
        collection,
        context,
        options,
      );
    },
    get(collection, id, options, context) {
      return run<AgentNativeExtensionStorageRow | null>(
        "get",
        collection,
        context,
        options,
        id,
      );
    },
    set(collection, id, data, options, context) {
      return run<AgentNativeExtensionStorageRow>(
        "set",
        collection,
        context,
        options,
        id,
        data,
      );
    },
    remove(collection, id, options, context) {
      return run<{ removed: boolean }>(
        "remove",
        collection,
        context,
        options,
        id,
      );
    },
  };
}

export function normalizeAgentNativeExtensionSandbox(
  sandbox: string | undefined,
): string {
  const tokens = new Set(
    (sandbox ?? "allow-scripts allow-forms allow-popups allow-downloads")
      .split(/\s+/)
      .filter(Boolean),
  );
  tokens.delete("allow-same-origin");
  tokens.add("allow-scripts");
  return Array.from(tokens).join(" ");
}

export function buildAgentNativeExtensionHtml({
  extensionId,
  content,
  title,
  slotId,
  slotContext,
  themeCss = "",
  isDark = false,
}: BuildAgentNativeExtensionHtmlOptions): string {
  const extensionIdJson = safeJson(extensionId);
  const slotIdJson = safeJson(slotId ?? "");
  const slotContextJson = safeJson(slotContext ?? {});
  const messageTypesJson = safeJson({
    host: AGENT_NATIVE_HOST_MESSAGE_TYPES,
    extension: AGENT_NATIVE_EXTENSION_MESSAGE_TYPES,
  });
  const titleText = title ?? "Agent Native extension";

  return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="dark"' : ""}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(EXTENSION_IFRAME_META_CSP)}" />
  <title>${escapeHtmlAttribute(titleText)}</title>
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
      --color-border: hsl(var(--border, 214 32% 91%));
      --color-background: hsl(var(--background, 0 0% 100%));
      --color-foreground: hsl(var(--foreground, 222 47% 11%));
      --color-primary: hsl(var(--primary, 222 47% 11%));
      --color-primary-foreground: hsl(var(--primary-foreground, 210 40% 98%));
      --color-muted: hsl(var(--muted, 210 40% 96%));
      --color-muted-foreground: hsl(var(--muted-foreground, 215 16% 47%));
      --color-card: hsl(var(--card, 0 0% 100%));
      --color-card-foreground: hsl(var(--card-foreground, 222 47% 11%));
      --radius-lg: var(--radius, .5rem);
      --radius-md: calc(var(--radius, .5rem) - 2px);
      --radius-sm: calc(var(--radius, .5rem) - 4px);
    }
  </style>
  <style>
    *, *::before, *::after { box-sizing: border-box; border-color: hsl(var(--border, 214 32% 91%)); }
    html, body { margin: 0; min-height: 100%; background: transparent; color: hsl(var(--foreground, 222 47% 11%)); }
    body {
      --agent-native-extension-padding: clamp(12px, 2vw, 20px);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      padding: var(--agent-native-extension-padding);
    }
    body:has(> [data-extension-layout="full-bleed"]),
    body:has(> [data-extension-padding="none"]),
    body:has(> .agent-native-extension-bleed) {
      padding: 0;
    }
  </style>
  <script>
    (function() {
      var messageTypes = ${messageTypesJson};
      var extensionId = ${extensionIdJson};
      var slotId = ${slotIdJson};
      var slotContext = ${slotContextJson};
      var requestSeq = 0;
      var pending = {};

      function nextRequestId(prefix) {
        requestSeq += 1;
        return prefix + '-' + Date.now() + '-' + requestSeq;
      }

      function failMessage(message, fallback) {
        return typeof message.error === 'string' ? message.error : fallback;
      }

      function requestParent(message, responseType, timeoutMs) {
        timeoutMs = timeoutMs || 30000;
        return new Promise(function(resolve, reject) {
          var requestId = message.requestId || nextRequestId('extension');
          var timer = setTimeout(function() {
            delete pending[requestId];
            reject(new Error('Timed out waiting for host response'));
          }, timeoutMs);
          pending[requestId] = {
            responseType: responseType,
            resolve: resolve,
            reject: reject,
            timer: timer,
          };
          window.parent.postMessage(Object.assign({}, message, { requestId: requestId }), '*');
        });
      }

      window.addEventListener('message', function(event) {
        if (event.source !== window.parent) return;
        var message = event.data || {};

        if (message.type === messageTypes.host.INIT) {
          agentNative.init = message;
          agentNative.contextSnapshot = message.context || null;
          agentNative.actionsSnapshot = message.actions || [];
          window.dispatchEvent(new CustomEvent('agentNative:init', { detail: message }));
          return;
        }

        if (message.type === messageTypes.extension.SLOT_CONTEXT) {
          slotContext = message.context || {};
          agentNative.slotContext = slotContext;
          window.slotContext = slotContext;
          window.dispatchEvent(new CustomEvent('agentNative:slot-context', { detail: slotContext }));
          return;
        }

        var entry = pending[message.requestId];
        if (!entry || message.type !== entry.responseType) return;
        delete pending[message.requestId];
        clearTimeout(entry.timer);
        if (message.ok === false) {
          entry.reject(new Error(failMessage(message, 'Host request failed')));
        } else {
          entry.resolve(message);
        }
      });

      function hostContext() {
        return requestParent(
          { type: messageTypes.host.GET_CONTEXT },
          messageTypes.host.CONTEXT,
        ).then(function(message) { return message.context || {}; });
      }

      function hostActions() {
        return requestParent(
          { type: messageTypes.host.LIST_ACTIONS },
          messageTypes.host.ACTIONS,
        ).then(function(message) { return message.actions || []; });
      }

      function hostAction(name, args) {
        return requestParent(
          { type: messageTypes.host.RUN_ACTION, name: name, args: args || {} },
          messageTypes.host.ACTION_RESULT,
        ).then(function(message) { return message.result; });
      }

      function hostCommand(command, payload) {
        return requestParent(
          { type: messageTypes.host.COMMAND, command: command, payload: payload },
          messageTypes.host.COMMAND_RESULT,
        ).then(function(message) { return message.result; });
      }

      function storageRequest(op, collection, id, data, options) {
        return requestParent(
          {
            type: messageTypes.extension.STORAGE_REQUEST,
            op: op,
            collection: collection,
            id: id,
            data: data,
            options: options || {},
          },
          messageTypes.extension.STORAGE_RESPONSE,
        ).then(function(message) { return message.result; });
      }

      var extensionData = {
        list: function(collection, options) {
          return storageRequest('list', collection, undefined, undefined, options);
        },
        get: function(collection, id, options) {
          return storageRequest('get', collection, id, undefined, options);
        },
        set: function(collection, id, data, options) {
          return storageRequest('set', collection, id, data, options);
        },
        remove: function(collection, id, options) {
          return storageRequest('remove', collection, id, undefined, options);
        },
      };

      var agentNative = {
        version: '0.1.0',
        extensionId: extensionId,
        slotId: slotId,
        slotContext: slotContext,
        contextSnapshot: null,
        actionsSnapshot: [],
        init: null,
        context: hostContext,
        listActions: hostActions,
        action: hostAction,
        command: hostCommand,
        refresh: function(payload) { return hostCommand('refreshData', payload); },
        data: extensionData,
      };

      window.agentNative = agentNative;
      window.appAction = hostAction;
      window.extensionData = extensionData;
      window.toolData = extensionData;
      window.extensionId = extensionId;
      window.toolId = extensionId;
      window.slotContext = slotContext;

      function reportHeight() {
        try {
          var doc = document.documentElement;
          var body = document.body;
          var height = Math.max(
            doc ? doc.scrollHeight : 0,
            doc ? doc.offsetHeight : 0,
            body ? body.scrollHeight : 0,
            body ? body.offsetHeight : 0,
          );
          window.parent.postMessage({
            type: messageTypes.extension.RESIZE,
            extensionId: extensionId,
            slotId: slotId,
            height: height,
          }, '*');
        } catch (_) {}
      }

      window.addEventListener('load', reportHeight);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(reportHeight).observe(document.documentElement);
      } else {
        setInterval(reportHeight, 1000);
      }

      window.parent.postMessage({
        type: messageTypes.host.READY,
        requestId: nextRequestId('ready'),
      }, '*');
    })();
  </script>
</head>
<body>
${content}
</body>
</html>`;
}
