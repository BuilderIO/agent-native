import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import {
  ServerRouter,
  isRouteErrorResponse,
  UNSAFE_withComponentProps,
  Outlet,
  Meta,
  Links,
  ScrollRestoration,
  Scripts,
  useNavigate,
  UNSAFE_withHydrateFallbackProps,
  useParams,
} from "react-router";
import ReactDOMServer from "react-dom/server.browser";
import { isbot } from "isbot";
import * as React from "react";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  useQueryClient,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useTheme, ThemeProvider } from "next-themes";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import fs from "fs";
import sysPath from "path";
import require$$1 from "os";
import require$$0 from "crypto";
import "@libsql/client";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva } from "class-variance-authority";
import {
  X,
  Sun,
  Moon,
  ChevronRight,
  Check,
  Circle,
  FileText,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  Search,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Link,
  Type,
  List,
  ListOrdered,
  CheckSquare,
  Code2,
  Quote,
  Minus,
  Table,
  ExternalLink,
  Unlink,
  Loader2,
} from "lucide-react";
import { Toaster as Toaster$2, toast as toast$1 } from "sonner";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { Slot } from "@radix-ui/react-slot";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  EditorContent,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link$1 from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table as Table$1 } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { BubbleMenu } from "@tiptap/react/menus";
import Image from "@tiptap/extension-image";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";
const { renderToReadableStream } = ReactDOMServer;
const streamTimeout = 5e3;
async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  routerContext,
  _loadContext,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }
  const userAgent = request.headers.get("user-agent");
  const waitForAll = (userAgent && isbot(userAgent)) || routerContext.isSpaMode;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), streamTimeout);
  try {
    const body = await renderToReadableStream(
      /* @__PURE__ */ jsx(ServerRouter, {
        context: routerContext,
        url: request.url,
      }),
      {
        signal: abortController.signal,
        onError(error) {
          if (!abortController.signal.aborted) {
            responseStatusCode = 500;
            console.error(error);
          }
        },
      },
    );
    if (waitForAll) {
      await body.allReady;
    }
    responseHeaders.set("Content-Type", "text/html");
    return new Response(body, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
const entryServer = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: handleRequest,
      streamTimeout,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (
    typeof state === "function"
      ? receiver !== state || true
      : !state.has(receiver)
  )
    throw new TypeError(
      "Cannot write private member to an object whose class did not declare it",
    );
  return (state.set(receiver, value), value);
}
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (
    typeof state === "function"
      ? receiver !== state || !f
      : !state.has(receiver)
  )
    throw new TypeError(
      "Cannot read private member from an object whose class did not declare it",
    );
  return kind === "m"
    ? f
    : kind === "a"
      ? f.call(receiver)
      : f
        ? f.value
        : state.get(receiver);
}
let uuid4 = function () {
  const { crypto } = globalThis;
  if (crypto?.randomUUID) {
    uuid4 = crypto.randomUUID.bind(crypto);
    return crypto.randomUUID();
  }
  const u8 = new Uint8Array(1);
  const randomByte = crypto
    ? () => crypto.getRandomValues(u8)[0]
    : () => (Math.random() * 255) & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (randomByte() & (15 >> (+c / 4)))).toString(16),
  );
};
function isAbortError(err) {
  return (
    typeof err === "object" &&
    err !== null && // Spec-compliant fetch implementations
    (("name" in err && err.name === "AbortError") || // Expo fetch
      ("message" in err &&
        String(err.message).includes("FetchRequestCanceledException")))
  );
}
const castToError = (err) => {
  if (err instanceof Error) return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(
          err.message,
          err.cause ? { cause: err.cause } : {},
        );
        if (err.stack) error.stack = err.stack;
        if (err.cause && !error.cause) error.cause = err.cause;
        if (err.name) error.name = err.name;
        return error;
      }
    } catch {}
    try {
      return new Error(JSON.stringify(err));
    } catch {}
  }
  return new Error(err);
};
class AnthropicError extends Error {}
class APIError extends AnthropicError {
  constructor(status, error, message, headers) {
    super(`${APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("request-id");
    this.error = error;
  }
  static makeMessage(status, error, message) {
    const msg = error?.message
      ? typeof error.message === "string"
        ? error.message
        : JSON.stringify(error.message)
      : error
        ? JSON.stringify(error)
        : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status || !headers) {
      return new APIConnectionError({
        message,
        cause: castToError(errorResponse),
      });
    }
    const error = errorResponse;
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new APIError(status, error, message, headers);
  }
}
class APIUserAbortError extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
}
class APIConnectionError extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause) this.cause = cause;
  }
}
class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
}
class BadRequestError extends APIError {}
class AuthenticationError extends APIError {}
class PermissionDeniedError extends APIError {}
class NotFoundError extends APIError {}
class ConflictError extends APIError {}
class UnprocessableEntityError extends APIError {}
class RateLimitError extends APIError {}
class InternalServerError extends APIError {}
const startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
const isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
let isArray = (val) => ((isArray = Array.isArray), isArray(val));
let isReadonlyArray = isArray;
function maybeObj(x) {
  if (typeof x !== "object") {
    return {};
  }
  return x ?? {};
}
function isEmptyObj(obj) {
  if (!obj) return true;
  for (const _k in obj) return false;
  return true;
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
const validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new AnthropicError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new AnthropicError(`${name} must be a positive integer`);
  }
  return n;
};
const safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return void 0;
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VERSION = "0.80.0";
const isRunningInBrowser = () => {
  return (
    // @ts-ignore
    typeof window !== "undefined" && // @ts-ignore
    typeof window.document !== "undefined" && // @ts-ignore
    typeof navigator !== "undefined"
  );
};
function getDetectedPlatform() {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return "deno";
  }
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (
    Object.prototype.toString.call(
      typeof globalThis.process !== "undefined" ? globalThis.process : 0,
    ) === "[object process]"
  ) {
    return "node";
  }
  return "unknown";
}
const getPlatformProperties = () => {
  const detectedPlatform = getDetectedPlatform();
  if (detectedPlatform === "deno") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version":
        typeof Deno.version === "string"
          ? Deno.version
          : (Deno.version?.deno ?? "unknown"),
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version,
    };
  }
  if (detectedPlatform === "node") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(
        globalThis.process.platform ?? "unknown",
      ),
      "X-Stainless-Arch": normalizeArch(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown",
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version,
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown",
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    {
      key: "safari",
      pattern:
        /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/,
    },
  ];
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
const normalizeArch = (arch) => {
  if (arch === "x32") return "x32";
  if (arch === "x86_64" || arch === "x64") return "x64";
  if (arch === "arm") return "arm";
  if (arch === "aarch64" || arch === "arm64") return "arm64";
  if (arch) return `other:${arch}`;
  return "unknown";
};
const normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios")) return "iOS";
  if (platform === "android") return "Android";
  if (platform === "darwin") return "MacOS";
  if (platform === "win32") return "Windows";
  if (platform === "freebsd") return "FreeBSD";
  if (platform === "openbsd") return "OpenBSD";
  if (platform === "linux") return "Linux";
  if (platform) return `Other:${platform}`;
  return "Unknown";
};
let _platformHeaders;
const getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};
function getDefaultFetch() {
  if (typeof fetch !== "undefined") {
    return fetch;
  }
  throw new Error(
    "`fetch` is not defined as a global; Either pass `fetch` to the client, `new Anthropic({ fetch })` or polyfill the global, `globalThis.fetch = fetch`",
  );
}
function makeReadableStream(...args) {
  const ReadableStream = globalThis.ReadableStream;
  if (typeof ReadableStream === "undefined") {
    throw new Error(
      "`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`",
    );
  }
  return new ReadableStream(...args);
}
function ReadableStreamFrom(iterable) {
  let iter =
    Symbol.asyncIterator in iterable
      ? iterable[Symbol.asyncIterator]()
      : iterable[Symbol.iterator]();
  return makeReadableStream({
    start() {},
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await iter.return?.();
    },
  });
}
function ReadableStreamToAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator]) return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done) reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
async function CancelReadableStream(stream) {
  if (stream === null || typeof stream !== "object") return;
  if (stream[Symbol.asyncIterator]) {
    await stream[Symbol.asyncIterator]().return?.();
    return;
  }
  const reader = stream.getReader();
  const cancelPromise = reader.cancel();
  reader.releaseLock();
  await cancelPromise;
}
const FallbackEncoder = ({ headers, body }) => {
  return {
    bodyHeaders: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
};
function stringifyQuery(query) {
  return Object.entries(query)
    .filter(([_, value]) => typeof value !== "undefined")
    .map(([key, value]) => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      }
      if (value === null) {
        return `${encodeURIComponent(key)}=`;
      }
      throw new AnthropicError(
        `Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`,
      );
    })
    .join("&");
}
function concatBytes(buffers) {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}
let encodeUTF8_;
function encodeUTF8(str) {
  let encoder;
  return (
    encodeUTF8_ ??
    ((encoder = new globalThis.TextEncoder()),
    (encodeUTF8_ = encoder.encode.bind(encoder)))
  )(str);
}
let decodeUTF8_;
function decodeUTF8(bytes) {
  let decoder;
  return (
    decodeUTF8_ ??
    ((decoder = new globalThis.TextDecoder()),
    (decodeUTF8_ = decoder.decode.bind(decoder)))
  )(bytes);
}
var _LineDecoder_buffer, _LineDecoder_carriageReturnIndex;
class LineDecoder {
  constructor() {
    _LineDecoder_buffer.set(this, void 0);
    _LineDecoder_carriageReturnIndex.set(this, void 0);
    __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array());
    __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
  }
  decode(chunk) {
    if (chunk == null) {
      return [];
    }
    const binaryChunk =
      chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : typeof chunk === "string"
          ? encodeUTF8(chunk)
          : chunk;
    __classPrivateFieldSet(
      this,
      _LineDecoder_buffer,
      concatBytes([
        __classPrivateFieldGet(this, _LineDecoder_buffer, "f"),
        binaryChunk,
      ]),
    );
    const lines = [];
    let patternIndex;
    while (
      (patternIndex = findNewlineIndex(
        __classPrivateFieldGet(this, _LineDecoder_buffer, "f"),
        __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"),
      )) != null
    ) {
      if (
        patternIndex.carriage &&
        __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") ==
          null
      ) {
        __classPrivateFieldSet(
          this,
          _LineDecoder_carriageReturnIndex,
          patternIndex.index,
        );
        continue;
      }
      if (
        __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !=
          null &&
        (patternIndex.index !==
          __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") +
            1 ||
          patternIndex.carriage)
      ) {
        lines.push(
          decodeUTF8(
            __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(
              0,
              __classPrivateFieldGet(
                this,
                _LineDecoder_carriageReturnIndex,
                "f",
              ) - 1,
            ),
          ),
        );
        __classPrivateFieldSet(
          this,
          _LineDecoder_buffer,
          __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(
            __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"),
          ),
        );
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
        continue;
      }
      const endIndex =
        __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !==
        null
          ? patternIndex.preceding - 1
          : patternIndex.preceding;
      const line = decodeUTF8(
        __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(
          0,
          endIndex,
        ),
      );
      lines.push(line);
      __classPrivateFieldSet(
        this,
        _LineDecoder_buffer,
        __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(
          patternIndex.index,
        ),
      );
      __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
    }
    return lines;
  }
  flush() {
    if (!__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
      return [];
    }
    return this.decode("\n");
  }
}
((_LineDecoder_buffer = /* @__PURE__ */ new WeakMap()),
  (_LineDecoder_carriageReturnIndex = /* @__PURE__ */ new WeakMap()));
LineDecoder.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function findNewlineIndex(buffer, startIndex) {
  const newline = 10;
  const carriage = 13;
  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }
    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }
  return null;
}
function findDoubleNewlineIndex(buffer) {
  const newline = 10;
  const carriage = 13;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (
      buffer[i] === carriage &&
      buffer[i + 1] === newline &&
      i + 3 < buffer.length &&
      buffer[i + 2] === carriage &&
      buffer[i + 3] === newline
    ) {
      return i + 4;
    }
  }
  return -1;
}
const levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500,
};
const parseLogLevel = (maybeLevel, sourceName, client) => {
  if (!maybeLevel) {
    return void 0;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(
    `${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`,
  );
  return void 0;
};
function noop() {}
function makeLogFn(fnLevel, logger, logLevel) {
  if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger[fnLevel].bind(logger);
  }
}
const noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
};
let cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger, logLevel),
    warn: makeLogFn("warn", logger, logLevel),
    info: makeLogFn("info", logger, logLevel),
    debug: makeLogFn("debug", logger, logLevel),
  };
  cachedLoggers.set(logger, [logLevel, levelLogger]);
  return levelLogger;
}
const formatRequestDetails = (details) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options["headers"];
  }
  if (details.headers) {
    details.headers = Object.fromEntries(
      (details.headers instanceof Headers
        ? [...details.headers]
        : Object.entries(details.headers)
      ).map(([name, value]) => [
        name,
        name.toLowerCase() === "x-api-key" ||
        name.toLowerCase() === "authorization" ||
        name.toLowerCase() === "cookie" ||
        name.toLowerCase() === "set-cookie"
          ? "***"
          : value,
      ]),
    );
  }
  if ("retryOfRequestLogID" in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};
var _Stream_client;
class Stream {
  constructor(iterator, controller, client) {
    this.iterator = iterator;
    _Stream_client.set(this, void 0);
    this.controller = controller;
    __classPrivateFieldSet(this, _Stream_client, client);
  }
  static fromSSEResponse(response, controller, client) {
    let consumed = false;
    const logger = client ? loggerFor(client) : console;
    async function* iterator() {
      if (consumed) {
        throw new AnthropicError(
          "Cannot iterate over a consumed stream, use `.tee()` to split the stream.",
        );
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (sse.event === "completion") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (
            sse.event === "message_start" ||
            sse.event === "message_delta" ||
            sse.event === "message_stop" ||
            sse.event === "content_block_start" ||
            sse.event === "content_block_delta" ||
            sse.event === "content_block_stop"
          ) {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "ping") {
            continue;
          }
          if (sse.event === "error") {
            throw new APIError(
              void 0,
              safeJSON(sse.data) ?? sse.data,
              void 0,
              response.headers,
            );
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e)) return;
        throw e;
      } finally {
        if (!done) controller.abort();
      }
    }
    return new Stream(iterator, controller, client);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(readableStream, controller, client) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder();
      const iter = ReadableStreamToAsyncIterable(readableStream);
      for await (const chunk of iter) {
        for (const line of lineDecoder.decode(chunk)) {
          yield line;
        }
      }
      for (const line of lineDecoder.flush()) {
        yield line;
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new AnthropicError(
          "Cannot iterate over a consumed stream, use `.tee()` to split the stream.",
        );
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done) continue;
          if (line) yield JSON.parse(line);
        }
        done = true;
      } catch (e) {
        if (isAbortError(e)) return;
        throw e;
      } finally {
        if (!done) controller.abort();
      }
    }
    return new Stream(iterator, controller, client);
  }
  [((_Stream_client = /* @__PURE__ */ new WeakMap()), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const left = [];
    const right = [];
    const iterator = this.iterator();
    const teeIterator = (queue) => {
      return {
        next: () => {
          if (queue.length === 0) {
            const result = iterator.next();
            left.push(result);
            right.push(result);
          }
          return queue.shift();
        },
      };
    };
    return [
      new Stream(
        () => teeIterator(left),
        this.controller,
        __classPrivateFieldGet(this, _Stream_client, "f"),
      ),
      new Stream(
        () => teeIterator(right),
        this.controller,
        __classPrivateFieldGet(this, _Stream_client, "f"),
      ),
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    const self = this;
    let iter;
    return makeReadableStream({
      async start() {
        iter = self[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done) return ctrl.close();
          const bytes = encodeUTF8(JSON.stringify(value) + "\n");
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      },
    });
  }
}
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    if (
      typeof globalThis.navigator !== "undefined" &&
      globalThis.navigator.product === "ReactNative"
    ) {
      throw new AnthropicError(
        `The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`,
      );
    }
    throw new AnthropicError(
      `Attempted to iterate over a response with no body`,
    );
  }
  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = ReadableStreamToAsyncIterable(response.body);
  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse) yield sse;
    }
  }
  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse) yield sse;
  }
}
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array();
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    const binaryChunk =
      chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : typeof chunk === "string"
          ? encodeUTF8(chunk)
          : chunk;
    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.slice(patternIndex);
    }
  }
  if (data.length > 0) {
    yield data;
  }
}
class SSEDecoder {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length) return null;
      const sse = {
        event: this.event,
        data: this.data.join("\n"),
        raw: this.chunks,
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    let [fieldname, _, value] = partition(line, ":");
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
}
function partition(str, delimiter) {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [
      str.substring(0, index),
      delimiter,
      str.substring(index + delimiter.length),
    ];
  }
  return [str, "", ""];
}
async function defaultParseResponse(client, props) {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
    if (props.options.stream) {
      loggerFor(client).debug(
        "response",
        response.status,
        response.url,
        response.headers,
        response.body,
      );
      if (props.options.__streamClass) {
        return props.options.__streamClass.fromSSEResponse(
          response,
          props.controller,
        );
      }
      return Stream.fromSSEResponse(response, props.controller);
    }
    if (response.status === 204) {
      return null;
    }
    if (props.options.__binaryResponse) {
      return response;
    }
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";")[0]?.trim();
    const isJSON =
      mediaType?.includes("application/json") || mediaType?.endsWith("+json");
    if (isJSON) {
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        return void 0;
      }
      const json = await response.json();
      return addRequestID(json, response);
    }
    const text = await response.text();
    return text;
  })();
  loggerFor(client).debug(
    `[${requestLogID}] response parsed`,
    formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      body,
      durationMs: Date.now() - startTime,
    }),
  );
  return body;
}
function addRequestID(value, response) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.defineProperty(value, "_request_id", {
    value: response.headers.get("request-id"),
    enumerable: false,
  });
}
var _APIPromise_client;
class APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse = defaultParseResponse) {
    super((resolve) => {
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse;
    _APIPromise_client.set(this, void 0);
    __classPrivateFieldSet(this, _APIPromise_client, client);
  }
  _thenUnwrap(transform) {
    return new APIPromise(
      __classPrivateFieldGet(this, _APIPromise_client, "f"),
      this.responsePromise,
      async (client, props) =>
        addRequestID(
          transform(await this.parseResponse(client, props), props),
          props.response,
        ),
    );
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data, the raw `Response` instance and the ID of the request,
   * returned via the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse() {
    const [data, response] = await Promise.all([
      this.parse(),
      this.asResponse(),
    ]);
    return { data, response, request_id: response.headers.get("request-id") };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) =>
        this.parseResponse(
          __classPrivateFieldGet(this, _APIPromise_client, "f"),
          data,
        ),
      );
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
}
_APIPromise_client = /* @__PURE__ */ new WeakMap();
var _AbstractPage_client;
class AbstractPage {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, void 0);
    __classPrivateFieldSet(this, _AbstractPage_client, client);
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length) return false;
    return this.nextPageRequestOptions() != null;
  }
  async getNextPage() {
    const nextOptions = this.nextPageRequestOptions();
    if (!nextOptions) {
      throw new AnthropicError(
        "No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.",
      );
    }
    return await __classPrivateFieldGet(
      this,
      _AbstractPage_client,
      "f",
    ).requestAPIList(this.constructor, nextOptions);
  }
  async *iterPages() {
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async *[((_AbstractPage_client = /* @__PURE__ */ new WeakMap()),
  Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
}
class PagePromise extends APIPromise {
  constructor(client, request, Page2) {
    super(
      client,
      request,
      async (client2, props) =>
        new Page2(
          client2,
          props.response,
          await defaultParseResponse(client2, props),
          props.options,
        ),
    );
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
}
class Page extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.first_id = body.first_id || null;
    this.last_id = body.last_id || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    if (this.options.query?.["before_id"]) {
      const first_id = this.first_id;
      if (!first_id) {
        return null;
      }
      return {
        ...this.options,
        query: {
          ...maybeObj(this.options.query),
          before_id: first_id,
        },
      };
    }
    const cursor = this.last_id;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after_id: cursor,
      },
    };
  }
}
class PageCursor extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.next_page = body.next_page || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const cursor = this.next_page;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        page: cursor,
      },
    };
  }
}
const checkFileSupport = () => {
  if (typeof File === "undefined") {
    const { process: process2 } = globalThis;
    const isOldNode =
      typeof process2?.versions?.node === "string" &&
      parseInt(process2.versions.node.split(".")) < 20;
    throw new Error(
      "`File` is not defined as a global, which is required for file uploads." +
        (isOldNode
          ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`."
          : ""),
    );
  }
};
function makeFile(fileBits, fileName, options) {
  checkFileSupport();
  return new File(fileBits, fileName ?? "unknown_file", options);
}
function getName(value, stripPath) {
  const val =
    (typeof value === "object" &&
      value !== null &&
      (("name" in value && value.name && String(value.name)) ||
        ("url" in value && value.url && String(value.url)) ||
        ("filename" in value && value.filename && String(value.filename)) ||
        ("path" in value && value.path && String(value.path)))) ||
    "";
  return stripPath ? val.split(/[\\/]/).pop() || void 0 : val;
}
const isAsyncIterable = (value) =>
  value != null &&
  typeof value === "object" &&
  typeof value[Symbol.asyncIterator] === "function";
const multipartFormRequestOptions = async (
  opts,
  fetch2,
  stripFilenames = true,
) => {
  return { ...opts, body: await createForm(opts.body, fetch2, stripFilenames) };
};
const supportsFormDataMap = /* @__PURE__ */ new WeakMap();
function supportsFormData(fetchObject) {
  const fetch2 =
    typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const FetchResponse =
        "Response" in fetch2
          ? fetch2.Response
          : (await fetch2("data:,")).constructor;
      const data = new FormData();
      if (data.toString() === (await new FetchResponse(data).text())) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  })();
  supportsFormDataMap.set(fetch2, promise);
  return promise;
}
const createForm = async (body, fetch2, stripFilenames = true) => {
  if (!(await supportsFormData(fetch2))) {
    throw new TypeError(
      "The provided fetch function does not support file uploads with the current global FormData class.",
    );
  }
  const form = new FormData();
  await Promise.all(
    Object.entries(body || {}).map(([key, value]) =>
      addFormValue(form, key, value, stripFilenames),
    ),
  );
  return form;
};
const isNamedBlob = (value) => value instanceof Blob && "name" in value;
const addFormValue = async (form, key, value, stripFilenames) => {
  if (value === void 0) return;
  if (value == null) {
    throw new TypeError(
      `Received null for "${key}"; to pass null in FormData, you must use the string 'null'`,
    );
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    let options = {};
    const contentType = value.headers.get("Content-Type");
    if (contentType) {
      options = { type: contentType };
    }
    form.append(
      key,
      makeFile([await value.blob()], getName(value, stripFilenames), options),
    );
  } else if (isAsyncIterable(value)) {
    form.append(
      key,
      makeFile(
        [await new Response(ReadableStreamFrom(value)).blob()],
        getName(value, stripFilenames),
      ),
    );
  } else if (isNamedBlob(value)) {
    form.append(
      key,
      makeFile([value], getName(value, stripFilenames), { type: value.type }),
    );
  } else if (Array.isArray(value)) {
    await Promise.all(
      value.map((entry2) =>
        addFormValue(form, key + "[]", entry2, stripFilenames),
      ),
    );
  } else if (typeof value === "object") {
    await Promise.all(
      Object.entries(value).map(([name, prop]) =>
        addFormValue(form, `${key}[${name}]`, prop, stripFilenames),
      ),
    );
  } else {
    throw new TypeError(
      `Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`,
    );
  }
};
const isBlobLike = (value) =>
  value != null &&
  typeof value === "object" &&
  typeof value.size === "number" &&
  typeof value.type === "string" &&
  typeof value.text === "function" &&
  typeof value.slice === "function" &&
  typeof value.arrayBuffer === "function";
const isFileLike = (value) =>
  value != null &&
  typeof value === "object" &&
  typeof value.name === "string" &&
  typeof value.lastModified === "number" &&
  isBlobLike(value);
const isResponseLike = (value) =>
  value != null &&
  typeof value === "object" &&
  typeof value.url === "string" &&
  typeof value.blob === "function";
async function toFile(value, name, options) {
  checkFileSupport();
  value = await value;
  name || (name = getName(value, true));
  if (isFileLike(value)) {
    if (value instanceof File && name == null && options == null) {
      return value;
    }
    return makeFile([await value.arrayBuffer()], name ?? value.name, {
      type: value.type,
      lastModified: value.lastModified,
      ...options,
    });
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = new URL(value.url).pathname.split(/[\\/]/).pop());
    return makeFile(await getBytes(blob), name, options);
  }
  const parts = await getBytes(value);
  if (!options?.type) {
    const type = parts.find(
      (part) => typeof part === "object" && "type" in part && part.type,
    );
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  let parts = [];
  if (
    typeof value === "string" ||
    ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
    value instanceof ArrayBuffer
  ) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : await value.arrayBuffer());
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      parts.push(...(await getBytes(chunk)));
    }
  } else {
    const constructor = value?.constructor?.name;
    throw new Error(
      `Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ""}${propsForError(value)}`,
    );
  }
  return parts;
}
function propsForError(value) {
  if (typeof value !== "object" || value === null) return "";
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(", ")}]`;
}
class APIResource {
  constructor(client) {
    this._client = client;
  }
}
const brand_privateNullableHeaders = /* @__PURE__ */ Symbol.for(
  "brand.privateNullableHeaders",
);
function* iterateHeaders(headers) {
  if (!headers) return;
  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }
  let shouldClear = false;
  let iter;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== "string")
      throw new TypeError("expected header name to be a string");
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === void 0) continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}
const buildHeaders = (newHeaders) => {
  const targetHeaders = new Headers();
  const nullHeaders = /* @__PURE__ */ new Set();
  for (const headers of newHeaders) {
    const seenHeaders = /* @__PURE__ */ new Set();
    for (const [name, value] of iterateHeaders(headers)) {
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(name);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(name);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(name, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return {
    [brand_privateNullableHeaders]: true,
    values: targetHeaders,
    nulls: nullHeaders,
  };
};
const SDK_HELPER_SYMBOL = /* @__PURE__ */ Symbol(
  "anthropic.sdk.stainlessHelper",
);
function wasCreatedByStainlessHelper(value) {
  return (
    typeof value === "object" && value !== null && SDK_HELPER_SYMBOL in value
  );
}
function collectStainlessHelpers(tools, messages) {
  const helpers = /* @__PURE__ */ new Set();
  if (tools) {
    for (const tool of tools) {
      if (wasCreatedByStainlessHelper(tool)) {
        helpers.add(tool[SDK_HELPER_SYMBOL]);
      }
    }
  }
  if (messages) {
    for (const message of messages) {
      if (wasCreatedByStainlessHelper(message)) {
        helpers.add(message[SDK_HELPER_SYMBOL]);
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (wasCreatedByStainlessHelper(block)) {
            helpers.add(block[SDK_HELPER_SYMBOL]);
          }
        }
      }
    }
  }
  return Array.from(helpers);
}
function stainlessHelperHeader(tools, messages) {
  const helpers = collectStainlessHelpers(tools, messages);
  if (helpers.length === 0) return {};
  return { "x-stainless-helper": helpers.join(", ") };
}
function stainlessHelperHeaderFromFile(file) {
  if (wasCreatedByStainlessHelper(file)) {
    return { "x-stainless-helper": file[SDK_HELPER_SYMBOL] };
  }
  return {};
}
function encodeURIPath(str) {
  return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
const EMPTY = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.create(null),
);
const createPathTagFunction = (pathEncoder = encodeURIPath) =>
  function path2(statics, ...params) {
    if (statics.length === 1) return statics[0];
    let postPath = false;
    const invalidSegments = [];
    const path3 = statics.reduce((previousValue, currentValue, index) => {
      if (/[?#]/.test(currentValue)) {
        postPath = true;
      }
      const value = params[index];
      let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
      if (
        index !== params.length &&
        (value == null ||
          (typeof value === "object" && // handle values from other realms
            value.toString ===
              Object.getPrototypeOf(
                Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY,
              )?.toString))
      ) {
        encoded = value + "";
        invalidSegments.push({
          start: previousValue.length + currentValue.length,
          length: encoded.length,
          error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`,
        });
      }
      return (
        previousValue + currentValue + (index === params.length ? "" : encoded)
      );
    }, "");
    const pathOnly = path3.split(/[?#]/, 1)[0];
    const invalidSegmentPattern = new RegExp(
      "(?<=^|\\/)(?:\\.|%2e){1,2}(?=\\/|$)",
      "gi",
    );
    let match;
    while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
      invalidSegments.push({
        start: match.index,
        length: match[0].length,
        error: `Value "${match[0]}" can't be safely passed as a path parameter`,
      });
    }
    invalidSegments.sort((a, b) => a.start - b.start);
    if (invalidSegments.length > 0) {
      let lastEnd = 0;
      const underline = invalidSegments.reduce((acc, segment) => {
        const spaces = " ".repeat(segment.start - lastEnd);
        const arrows = "^".repeat(segment.length);
        lastEnd = segment.start + segment.length;
        return acc + spaces + arrows;
      }, "");
      throw new AnthropicError(`Path parameters result in path with invalid segments:
${invalidSegments.map((e) => e.error).join("\n")}
${path3}
${underline}`);
    }
    return path3;
  };
const path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);
class Files extends APIResource {
  /**
   * List Files
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fileMetadata of client.beta.files.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/files", Page, {
      query,
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "files-api-2025-04-14",
          ].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * Delete File
   *
   * @example
   * ```ts
   * const deletedFile = await client.beta.files.delete(
   *   'file_id',
   * );
   * ```
   */
  delete(fileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/files/${fileID}`, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "files-api-2025-04-14",
          ].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * Download File
   *
   * @example
   * ```ts
   * const response = await client.beta.files.download(
   *   'file_id',
   * );
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  download(fileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "files-api-2025-04-14",
          ].toString(),
          Accept: "application/binary",
        },
        options?.headers,
      ]),
      __binaryResponse: true,
    });
  }
  /**
   * Get File Metadata
   *
   * @example
   * ```ts
   * const fileMetadata =
   *   await client.beta.files.retrieveMetadata('file_id');
   * ```
   */
  retrieveMetadata(fileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/files/${fileID}`, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "files-api-2025-04-14",
          ].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * Upload File
   *
   * @example
   * ```ts
   * const fileMetadata = await client.beta.files.upload({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  upload(params, options) {
    const { betas, ...body } = params;
    return this._client.post(
      "/v1/files",
      multipartFormRequestOptions(
        {
          body,
          ...options,
          headers: buildHeaders([
            {
              "anthropic-beta": [
                ...(betas ?? []),
                "files-api-2025-04-14",
              ].toString(),
            },
            stainlessHelperHeaderFromFile(body.file),
            options?.headers,
          ]),
        },
        this._client,
      ),
    );
  }
}
let Models$1 = class Models extends APIResource {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   *
   * @example
   * ```ts
   * const betaModelInfo = await client.beta.models.retrieve(
   *   'model_id',
   * );
   * ```
   */
  retrieve(modelID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/models/${modelID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        {
          ...(betas?.toString() != null
            ? { "anthropic-beta": betas?.toString() }
            : void 0),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaModelInfo of client.beta.models.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/models?beta=true", Page, {
      query,
      ...options,
      headers: buildHeaders([
        {
          ...(betas?.toString() != null
            ? { "anthropic-beta": betas?.toString() }
            : void 0),
        },
        options?.headers,
      ]),
    });
  }
};
const MODEL_NONSTREAMING_TOKENS = {
  "claude-opus-4-20250514": 8192,
  "claude-opus-4-0": 8192,
  "claude-4-opus-20250514": 8192,
  "anthropic.claude-opus-4-20250514-v1:0": 8192,
  "claude-opus-4@20250514": 8192,
  "claude-opus-4-1-20250805": 8192,
  "anthropic.claude-opus-4-1-20250805-v1:0": 8192,
  "claude-opus-4-1@20250805": 8192,
};
function getOutputFormat$1(params) {
  return params?.output_format ?? params?.output_config?.format;
}
function maybeParseBetaMessage(message, params, opts) {
  const outputFormat = getOutputFormat$1(params);
  if (!params || !("parse" in (outputFormat ?? {}))) {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "text") {
          const parsedBlock = Object.defineProperty(
            { ...block },
            "parsed_output",
            {
              value: null,
              enumerable: false,
            },
          );
          return Object.defineProperty(parsedBlock, "parsed", {
            get() {
              opts.logger.warn(
                "The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead.",
              );
              return null;
            },
            enumerable: false,
          });
        }
        return block;
      }),
      parsed_output: null,
    };
  }
  return parseBetaMessage(message, params, opts);
}
function parseBetaMessage(message, params, opts) {
  let firstParsedOutput = null;
  const content = message.content.map((block) => {
    if (block.type === "text") {
      const parsedOutput = parseBetaOutputFormat(params, block.text);
      if (firstParsedOutput === null) {
        firstParsedOutput = parsedOutput;
      }
      const parsedBlock = Object.defineProperty({ ...block }, "parsed_output", {
        value: parsedOutput,
        enumerable: false,
      });
      return Object.defineProperty(parsedBlock, "parsed", {
        get() {
          opts.logger.warn(
            "The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead.",
          );
          return parsedOutput;
        },
        enumerable: false,
      });
    }
    return block;
  });
  return {
    ...message,
    content,
    parsed_output: firstParsedOutput,
  };
}
function parseBetaOutputFormat(params, content) {
  const outputFormat = getOutputFormat$1(params);
  if (outputFormat?.type !== "json_schema") {
    return null;
  }
  try {
    if ("parse" in outputFormat) {
      return outputFormat.parse(content);
    }
    return JSON.parse(content);
  } catch (error) {
    throw new AnthropicError(`Failed to parse structured output: ${error}`);
  }
}
const tokenize = (input) => {
    let current = 0;
    let tokens = [];
    while (current < input.length) {
      let char = input[current];
      if (char === "\\") {
        current++;
        continue;
      }
      if (char === "{") {
        tokens.push({
          type: "brace",
          value: "{",
        });
        current++;
        continue;
      }
      if (char === "}") {
        tokens.push({
          type: "brace",
          value: "}",
        });
        current++;
        continue;
      }
      if (char === "[") {
        tokens.push({
          type: "paren",
          value: "[",
        });
        current++;
        continue;
      }
      if (char === "]") {
        tokens.push({
          type: "paren",
          value: "]",
        });
        current++;
        continue;
      }
      if (char === ":") {
        tokens.push({
          type: "separator",
          value: ":",
        });
        current++;
        continue;
      }
      if (char === ",") {
        tokens.push({
          type: "delimiter",
          value: ",",
        });
        current++;
        continue;
      }
      if (char === '"') {
        let value = "";
        let danglingQuote = false;
        char = input[++current];
        while (char !== '"') {
          if (current === input.length) {
            danglingQuote = true;
            break;
          }
          if (char === "\\") {
            current++;
            if (current === input.length) {
              danglingQuote = true;
              break;
            }
            value += char + input[current];
            char = input[++current];
          } else {
            value += char;
            char = input[++current];
          }
        }
        char = input[++current];
        if (!danglingQuote) {
          tokens.push({
            type: "string",
            value,
          });
        }
        continue;
      }
      let WHITESPACE = /\s/;
      if (char && WHITESPACE.test(char)) {
        current++;
        continue;
      }
      let NUMBERS = /[0-9]/;
      if ((char && NUMBERS.test(char)) || char === "-" || char === ".") {
        let value = "";
        if (char === "-") {
          value += char;
          char = input[++current];
        }
        while ((char && NUMBERS.test(char)) || char === ".") {
          value += char;
          char = input[++current];
        }
        tokens.push({
          type: "number",
          value,
        });
        continue;
      }
      let LETTERS = /[a-z]/i;
      if (char && LETTERS.test(char)) {
        let value = "";
        while (char && LETTERS.test(char)) {
          if (current === input.length) {
            break;
          }
          value += char;
          char = input[++current];
        }
        if (value == "true" || value == "false" || value === "null") {
          tokens.push({
            type: "name",
            value,
          });
        } else {
          current++;
          continue;
        }
        continue;
      }
      current++;
    }
    return tokens;
  },
  strip = (tokens) => {
    if (tokens.length === 0) {
      return tokens;
    }
    let lastToken = tokens[tokens.length - 1];
    switch (lastToken.type) {
      case "separator":
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      case "number":
        let lastCharacterOfLastToken =
          lastToken.value[lastToken.value.length - 1];
        if (
          lastCharacterOfLastToken === "." ||
          lastCharacterOfLastToken === "-"
        ) {
          tokens = tokens.slice(0, tokens.length - 1);
          return strip(tokens);
        }
      case "string":
        let tokenBeforeTheLastToken = tokens[tokens.length - 2];
        if (tokenBeforeTheLastToken?.type === "delimiter") {
          tokens = tokens.slice(0, tokens.length - 1);
          return strip(tokens);
        } else if (
          tokenBeforeTheLastToken?.type === "brace" &&
          tokenBeforeTheLastToken.value === "{"
        ) {
          tokens = tokens.slice(0, tokens.length - 1);
          return strip(tokens);
        }
        break;
      case "delimiter":
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
    }
    return tokens;
  },
  unstrip = (tokens) => {
    let tail = [];
    tokens.map((token) => {
      if (token.type === "brace") {
        if (token.value === "{") {
          tail.push("}");
        } else {
          tail.splice(tail.lastIndexOf("}"), 1);
        }
      }
      if (token.type === "paren") {
        if (token.value === "[") {
          tail.push("]");
        } else {
          tail.splice(tail.lastIndexOf("]"), 1);
        }
      }
    });
    if (tail.length > 0) {
      tail.reverse().map((item) => {
        if (item === "}") {
          tokens.push({
            type: "brace",
            value: "}",
          });
        } else if (item === "]") {
          tokens.push({
            type: "paren",
            value: "]",
          });
        }
      });
    }
    return tokens;
  },
  generate = (tokens) => {
    let output = "";
    tokens.map((token) => {
      switch (token.type) {
        case "string":
          output += '"' + token.value + '"';
          break;
        default:
          output += token.value;
          break;
      }
    });
    return output;
  },
  partialParse = (input) =>
    JSON.parse(generate(unstrip(strip(tokenize(input)))));
var _BetaMessageStream_instances,
  _BetaMessageStream_currentMessageSnapshot,
  _BetaMessageStream_params,
  _BetaMessageStream_connectedPromise,
  _BetaMessageStream_resolveConnectedPromise,
  _BetaMessageStream_rejectConnectedPromise,
  _BetaMessageStream_endPromise,
  _BetaMessageStream_resolveEndPromise,
  _BetaMessageStream_rejectEndPromise,
  _BetaMessageStream_listeners,
  _BetaMessageStream_ended,
  _BetaMessageStream_errored,
  _BetaMessageStream_aborted,
  _BetaMessageStream_catchingPromiseCreated,
  _BetaMessageStream_response,
  _BetaMessageStream_request_id,
  _BetaMessageStream_logger,
  _BetaMessageStream_getFinalMessage,
  _BetaMessageStream_getFinalText,
  _BetaMessageStream_handleError,
  _BetaMessageStream_beginRequest,
  _BetaMessageStream_addStreamEvent,
  _BetaMessageStream_endRequest,
  _BetaMessageStream_accumulateMessage;
const JSON_BUF_PROPERTY$1 = "__json_buf";
function tracksToolInput$1(content) {
  return (
    content.type === "tool_use" ||
    content.type === "server_tool_use" ||
    content.type === "mcp_tool_use"
  );
}
class BetaMessageStream {
  constructor(params, opts) {
    _BetaMessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _BetaMessageStream_currentMessageSnapshot.set(this, void 0);
    _BetaMessageStream_params.set(this, null);
    this.controller = new AbortController();
    _BetaMessageStream_connectedPromise.set(this, void 0);
    _BetaMessageStream_resolveConnectedPromise.set(this, () => {});
    _BetaMessageStream_rejectConnectedPromise.set(this, () => {});
    _BetaMessageStream_endPromise.set(this, void 0);
    _BetaMessageStream_resolveEndPromise.set(this, () => {});
    _BetaMessageStream_rejectEndPromise.set(this, () => {});
    _BetaMessageStream_listeners.set(this, {});
    _BetaMessageStream_ended.set(this, false);
    _BetaMessageStream_errored.set(this, false);
    _BetaMessageStream_aborted.set(this, false);
    _BetaMessageStream_catchingPromiseCreated.set(this, false);
    _BetaMessageStream_response.set(this, void 0);
    _BetaMessageStream_request_id.set(this, void 0);
    _BetaMessageStream_logger.set(this, void 0);
    _BetaMessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet(this, _BetaMessageStream_errored, true);
      if (isAbortError(error)) {
        error = new APIUserAbortError();
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet(this, _BetaMessageStream_aborted, true);
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError = new AnthropicError(error.message);
        anthropicError.cause = error;
        return this._emit("error", anthropicError);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_connectedPromise,
      new Promise((resolve, reject) => {
        __classPrivateFieldSet(
          this,
          _BetaMessageStream_resolveConnectedPromise,
          resolve,
          "f",
        );
        __classPrivateFieldSet(
          this,
          _BetaMessageStream_rejectConnectedPromise,
          reject,
          "f",
        );
      }),
    );
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_endPromise,
      new Promise((resolve, reject) => {
        __classPrivateFieldSet(
          this,
          _BetaMessageStream_resolveEndPromise,
          resolve,
          "f",
        );
        __classPrivateFieldSet(
          this,
          _BetaMessageStream_rejectEndPromise,
          reject,
          "f",
        );
      }),
    );
    __classPrivateFieldGet(
      this,
      _BetaMessageStream_connectedPromise,
      "f",
    ).catch(() => {});
    __classPrivateFieldGet(this, _BetaMessageStream_endPromise, "f").catch(
      () => {},
    );
    __classPrivateFieldSet(this, _BetaMessageStream_params, params);
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_logger,
      opts?.logger ?? console,
    );
  }
  get response() {
    return __classPrivateFieldGet(this, _BetaMessageStream_response, "f");
  }
  get request_id() {
    return __classPrivateFieldGet(this, _BetaMessageStream_request_id, "f");
  }
  /**
   * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
   * returned vie the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * This is the same as the `APIPromise.withResponse()` method.
   *
   * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
   * as no `Response` is available.
   */
  async withResponse() {
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_catchingPromiseCreated,
      true,
    );
    const response = await __classPrivateFieldGet(
      this,
      _BetaMessageStream_connectedPromise,
      "f",
    );
    if (!response) {
      throw new Error("Could not resolve a `Response` object");
    }
    return {
      data: this,
      response,
      request_id: response.headers.get("request-id"),
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new BetaMessageStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options, { logger } = {}) {
    const runner = new BetaMessageStream(params, { logger });
    for (const message of params.messages) {
      runner._addMessageParam(message);
    }
    __classPrivateFieldSet(runner, _BetaMessageStream_params, {
      ...params,
      stream: true,
    });
    runner._run(() =>
      runner._createMessage(
        messages,
        { ...params, stream: true },
        {
          ...options,
          headers: {
            ...options?.headers,
            "X-Stainless-Helper-Method": "stream",
          },
        },
      ),
    );
    return runner;
  }
  _run(executor) {
    executor().then(
      () => {
        this._emitFinal();
        this._emit("end");
      },
      __classPrivateFieldGet(this, _BetaMessageStream_handleError, "f"),
    );
  }
  _addMessageParam(message) {
    this.messages.push(message);
  }
  _addMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createMessage(messages, params, options) {
    const signal = options?.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_instances,
        "m",
        _BetaMessageStream_beginRequest,
      ).call(this);
      const { response, data: stream } = await messages
        .create(
          { ...params, stream: true },
          { ...options, signal: this.controller.signal },
        )
        .withResponse();
      this._connected(response);
      for await (const event of stream) {
        __classPrivateFieldGet(
          this,
          _BetaMessageStream_instances,
          "m",
          _BetaMessageStream_addStreamEvent,
        ).call(this, event);
      }
      if (stream.controller.signal?.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_instances,
        "m",
        _BetaMessageStream_endRequest,
      ).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  _connected(response) {
    if (this.ended) return;
    __classPrivateFieldSet(this, _BetaMessageStream_response, response);
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_request_id,
      response?.headers.get("request-id"),
    );
    __classPrivateFieldGet(
      this,
      _BetaMessageStream_resolveConnectedPromise,
      "f",
    ).call(this, response);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet(this, _BetaMessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet(this, _BetaMessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet(this, _BetaMessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this MessageStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners2 =
      __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] ||
      (__classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] =
        []);
    listeners2.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners2 = __classPrivateFieldGet(
      this,
      _BetaMessageStream_listeners,
      "f",
    )[event];
    if (!listeners2) return this;
    const index = listeners2.findIndex((l) => l.listener === listener);
    if (index >= 0) listeners2.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners2 =
      __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] ||
      (__classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] =
        []);
    listeners2.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(
        this,
        _BetaMessageStream_catchingPromiseCreated,
        true,
      );
      if (event !== "error") this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_catchingPromiseCreated,
      true,
    );
    await __classPrivateFieldGet(this, _BetaMessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet(
      this,
      _BetaMessageStream_currentMessageSnapshot,
      "f",
    );
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   * If structured outputs were used, this will be a ParsedMessage with a `parsed` field.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(
      this,
      _BetaMessageStream_instances,
      "m",
      _BetaMessageStream_getFinalMessage,
    ).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    await this.done();
    return __classPrivateFieldGet(
      this,
      _BetaMessageStream_instances,
      "m",
      _BetaMessageStream_getFinalText,
    ).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _BetaMessageStream_ended, "f")) return;
    if (event === "end") {
      __classPrivateFieldSet(this, _BetaMessageStream_ended, true);
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_resolveEndPromise,
        "f",
      ).call(this);
    }
    const listeners2 = __classPrivateFieldGet(
      this,
      _BetaMessageStream_listeners,
      "f",
    )[event];
    if (listeners2) {
      __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] =
        listeners2.filter((l) => !l.once);
      listeners2.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (
        !__classPrivateFieldGet(
          this,
          _BetaMessageStream_catchingPromiseCreated,
          "f",
        ) &&
        !listeners2?.length
      ) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_rejectConnectedPromise,
        "f",
      ).call(this, error);
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_rejectEndPromise,
        "f",
      ).call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (
        !__classPrivateFieldGet(
          this,
          _BetaMessageStream_catchingPromiseCreated,
          "f",
        ) &&
        !listeners2?.length
      ) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_rejectConnectedPromise,
        "f",
      ).call(this, error);
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_rejectEndPromise,
        "f",
      ).call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalMessage = this.receivedMessages.at(-1);
    if (finalMessage) {
      this._emit(
        "finalMessage",
        __classPrivateFieldGet(
          this,
          _BetaMessageStream_instances,
          "m",
          _BetaMessageStream_getFinalMessage,
        ).call(this),
      );
    }
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_instances,
        "m",
        _BetaMessageStream_beginRequest,
      ).call(this);
      this._connected(null);
      const stream = Stream.fromReadableStream(readableStream, this.controller);
      for await (const event of stream) {
        __classPrivateFieldGet(
          this,
          _BetaMessageStream_instances,
          "m",
          _BetaMessageStream_addStreamEvent,
        ).call(this, event);
      }
      if (stream.controller.signal?.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(
        this,
        _BetaMessageStream_instances,
        "m",
        _BetaMessageStream_endRequest,
      ).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  [((_BetaMessageStream_currentMessageSnapshot = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_params = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_connectedPromise = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_endPromise = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_resolveEndPromise = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_rejectEndPromise = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_listeners = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_ended = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_errored = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_aborted = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_response = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_request_id = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_logger = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_handleError = /* @__PURE__ */ new WeakMap()),
  (_BetaMessageStream_instances = /* @__PURE__ */ new WeakSet()),
  (_BetaMessageStream_getFinalMessage =
    function _BetaMessageStream_getFinalMessage2() {
      if (this.receivedMessages.length === 0) {
        throw new AnthropicError(
          "stream ended without producing a Message with role=assistant",
        );
      }
      return this.receivedMessages.at(-1);
    }),
  (_BetaMessageStream_getFinalText =
    function _BetaMessageStream_getFinalText2() {
      if (this.receivedMessages.length === 0) {
        throw new AnthropicError(
          "stream ended without producing a Message with role=assistant",
        );
      }
      const textBlocks = this.receivedMessages
        .at(-1)
        .content.filter((block) => block.type === "text")
        .map((block) => block.text);
      if (textBlocks.length === 0) {
        throw new AnthropicError(
          "stream ended without producing a content block with type=text",
        );
      }
      return textBlocks.join(" ");
    }),
  (_BetaMessageStream_beginRequest =
    function _BetaMessageStream_beginRequest2() {
      if (this.ended) return;
      __classPrivateFieldSet(
        this,
        _BetaMessageStream_currentMessageSnapshot,
        void 0,
      );
    }),
  (_BetaMessageStream_addStreamEvent =
    function _BetaMessageStream_addStreamEvent2(event) {
      if (this.ended) return;
      const messageSnapshot = __classPrivateFieldGet(
        this,
        _BetaMessageStream_instances,
        "m",
        _BetaMessageStream_accumulateMessage,
      ).call(this, event);
      this._emit("streamEvent", event, messageSnapshot);
      switch (event.type) {
        case "content_block_delta": {
          const content = messageSnapshot.content.at(-1);
          switch (event.delta.type) {
            case "text_delta": {
              if (content.type === "text") {
                this._emit("text", event.delta.text, content.text || "");
              }
              break;
            }
            case "citations_delta": {
              if (content.type === "text") {
                this._emit(
                  "citation",
                  event.delta.citation,
                  content.citations ?? [],
                );
              }
              break;
            }
            case "input_json_delta": {
              if (tracksToolInput$1(content) && content.input) {
                this._emit(
                  "inputJson",
                  event.delta.partial_json,
                  content.input,
                );
              }
              break;
            }
            case "thinking_delta": {
              if (content.type === "thinking") {
                this._emit("thinking", event.delta.thinking, content.thinking);
              }
              break;
            }
            case "signature_delta": {
              if (content.type === "thinking") {
                this._emit("signature", content.signature);
              }
              break;
            }
            case "compaction_delta": {
              if (content.type === "compaction" && content.content) {
                this._emit("compaction", content.content);
              }
              break;
            }
            default:
              checkNever$1(event.delta);
          }
          break;
        }
        case "message_stop": {
          this._addMessageParam(messageSnapshot);
          this._addMessage(
            maybeParseBetaMessage(
              messageSnapshot,
              __classPrivateFieldGet(this, _BetaMessageStream_params, "f"),
              {
                logger: __classPrivateFieldGet(
                  this,
                  _BetaMessageStream_logger,
                  "f",
                ),
              },
            ),
            true,
          );
          break;
        }
        case "content_block_stop": {
          this._emit("contentBlock", messageSnapshot.content.at(-1));
          break;
        }
        case "message_start": {
          __classPrivateFieldSet(
            this,
            _BetaMessageStream_currentMessageSnapshot,
            messageSnapshot,
          );
          break;
        }
      }
    }),
  (_BetaMessageStream_endRequest = function _BetaMessageStream_endRequest2() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(
      this,
      _BetaMessageStream_currentMessageSnapshot,
      "f",
    );
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet(
      this,
      _BetaMessageStream_currentMessageSnapshot,
      void 0,
    );
    return maybeParseBetaMessage(
      snapshot,
      __classPrivateFieldGet(this, _BetaMessageStream_params, "f"),
      { logger: __classPrivateFieldGet(this, _BetaMessageStream_logger, "f") },
    );
  }),
  (_BetaMessageStream_accumulateMessage =
    function _BetaMessageStream_accumulateMessage2(event) {
      let snapshot = __classPrivateFieldGet(
        this,
        _BetaMessageStream_currentMessageSnapshot,
        "f",
      );
      if (event.type === "message_start") {
        if (snapshot) {
          throw new AnthropicError(
            `Unexpected event order, got ${event.type} before receiving "message_stop"`,
          );
        }
        return event.message;
      }
      if (!snapshot) {
        throw new AnthropicError(
          `Unexpected event order, got ${event.type} before "message_start"`,
        );
      }
      switch (event.type) {
        case "message_stop":
          return snapshot;
        case "message_delta":
          snapshot.container = event.delta.container;
          snapshot.stop_reason = event.delta.stop_reason;
          snapshot.stop_sequence = event.delta.stop_sequence;
          snapshot.usage.output_tokens = event.usage.output_tokens;
          snapshot.context_management = event.context_management;
          if (event.usage.input_tokens != null) {
            snapshot.usage.input_tokens = event.usage.input_tokens;
          }
          if (event.usage.cache_creation_input_tokens != null) {
            snapshot.usage.cache_creation_input_tokens =
              event.usage.cache_creation_input_tokens;
          }
          if (event.usage.cache_read_input_tokens != null) {
            snapshot.usage.cache_read_input_tokens =
              event.usage.cache_read_input_tokens;
          }
          if (event.usage.server_tool_use != null) {
            snapshot.usage.server_tool_use = event.usage.server_tool_use;
          }
          if (event.usage.iterations != null) {
            snapshot.usage.iterations = event.usage.iterations;
          }
          return snapshot;
        case "content_block_start":
          snapshot.content.push(event.content_block);
          return snapshot;
        case "content_block_delta": {
          const snapshotContent = snapshot.content.at(event.index);
          switch (event.delta.type) {
            case "text_delta": {
              if (snapshotContent?.type === "text") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  text: (snapshotContent.text || "") + event.delta.text,
                };
              }
              break;
            }
            case "citations_delta": {
              if (snapshotContent?.type === "text") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  citations: [
                    ...(snapshotContent.citations ?? []),
                    event.delta.citation,
                  ],
                };
              }
              break;
            }
            case "input_json_delta": {
              if (snapshotContent && tracksToolInput$1(snapshotContent)) {
                let jsonBuf = snapshotContent[JSON_BUF_PROPERTY$1] || "";
                jsonBuf += event.delta.partial_json;
                const newContent = { ...snapshotContent };
                Object.defineProperty(newContent, JSON_BUF_PROPERTY$1, {
                  value: jsonBuf,
                  enumerable: false,
                  writable: true,
                });
                if (jsonBuf) {
                  try {
                    newContent.input = partialParse(jsonBuf);
                  } catch (err) {
                    const error = new AnthropicError(
                      `Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: ${err}. JSON: ${jsonBuf}`,
                    );
                    __classPrivateFieldGet(
                      this,
                      _BetaMessageStream_handleError,
                      "f",
                    ).call(this, error);
                  }
                }
                snapshot.content[event.index] = newContent;
              }
              break;
            }
            case "thinking_delta": {
              if (snapshotContent?.type === "thinking") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  thinking: snapshotContent.thinking + event.delta.thinking,
                };
              }
              break;
            }
            case "signature_delta": {
              if (snapshotContent?.type === "thinking") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  signature: event.delta.signature,
                };
              }
              break;
            }
            case "compaction_delta": {
              if (snapshotContent?.type === "compaction") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  content:
                    (snapshotContent.content || "") + event.delta.content,
                };
              }
              break;
            }
            default:
              checkNever$1(event.delta);
          }
          return snapshot;
        }
        case "content_block_stop":
          return snapshot;
      }
    }),
  Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) =>
            readQueue.push({ resolve, reject }),
          ).then((chunk2) =>
            chunk2
              ? { value: chunk2, done: false }
              : { value: void 0, done: true },
          );
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      },
    };
  }
  toReadableStream() {
    const stream = new Stream(
      this[Symbol.asyncIterator].bind(this),
      this.controller,
    );
    return stream.toReadableStream();
  }
}
function checkNever$1(x) {}
class ToolError extends Error {
  constructor(content) {
    const message =
      typeof content === "string"
        ? content
        : content
            .map((block) => {
              if (block.type === "text") return block.text;
              return `[${block.type}]`;
            })
            .join(" ");
    super(message);
    this.name = "ToolError";
    this.content = content;
  }
}
const DEFAULT_TOKEN_THRESHOLD = 1e5;
const DEFAULT_SUMMARY_PROMPT = `You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:
1. Task Overview
The user's core request and success criteria
Any clarifications or constraints they specified
2. Current State
What has been completed so far
Files created, modified, or analyzed (with paths if relevant)
Key outputs or artifacts produced
3. Important Discoveries
Technical constraints or requirements uncovered
Decisions made and their rationale
Errors encountered and how they were resolved
What approaches were tried that didn't work (and why)
4. Next Steps
Specific actions needed to complete the task
Any blockers or open questions to resolve
Priority order if multiple steps remain
5. Context to Preserve
User preferences or style requirements
Domain-specific details that aren't obvious
Any promises made to the user
Be concise but complete—err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.
Wrap your summary in <summary></summary> tags.`;
var _BetaToolRunner_instances,
  _BetaToolRunner_consumed,
  _BetaToolRunner_mutated,
  _BetaToolRunner_state,
  _BetaToolRunner_options,
  _BetaToolRunner_message,
  _BetaToolRunner_toolResponse,
  _BetaToolRunner_completion,
  _BetaToolRunner_iterationCount,
  _BetaToolRunner_checkAndCompact,
  _BetaToolRunner_generateToolResponse;
function promiseWithResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
class BetaToolRunner {
  constructor(client, params, options) {
    _BetaToolRunner_instances.add(this);
    this.client = client;
    _BetaToolRunner_consumed.set(this, false);
    _BetaToolRunner_mutated.set(this, false);
    _BetaToolRunner_state.set(this, void 0);
    _BetaToolRunner_options.set(this, void 0);
    _BetaToolRunner_message.set(this, void 0);
    _BetaToolRunner_toolResponse.set(this, void 0);
    _BetaToolRunner_completion.set(this, void 0);
    _BetaToolRunner_iterationCount.set(this, 0);
    __classPrivateFieldSet(this, _BetaToolRunner_state, {
      params: {
        // You can't clone the entire params since there are functions as handlers.
        // You also don't really need to clone params.messages, but it probably will prevent a foot gun
        // somewhere.
        ...params,
        messages: structuredClone(params.messages),
      },
    });
    const helpers = collectStainlessHelpers(params.tools, params.messages);
    const helperValue = ["BetaToolRunner", ...helpers].join(", ");
    __classPrivateFieldSet(this, _BetaToolRunner_options, {
      ...options,
      headers: buildHeaders([
        { "x-stainless-helper": helperValue },
        options?.headers,
      ]),
    });
    __classPrivateFieldSet(
      this,
      _BetaToolRunner_completion,
      promiseWithResolvers(),
    );
  }
  async *[((_BetaToolRunner_consumed = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_mutated = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_state = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_options = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_message = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_toolResponse = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_completion = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_iterationCount = /* @__PURE__ */ new WeakMap()),
  (_BetaToolRunner_instances = /* @__PURE__ */ new WeakSet()),
  (_BetaToolRunner_checkAndCompact =
    async function _BetaToolRunner_checkAndCompact2() {
      const compactionControl = __classPrivateFieldGet(
        this,
        _BetaToolRunner_state,
        "f",
      ).params.compactionControl;
      if (!compactionControl || !compactionControl.enabled) {
        return false;
      }
      let tokensUsed = 0;
      if (
        __classPrivateFieldGet(this, _BetaToolRunner_message, "f") !== void 0
      ) {
        try {
          const message = await __classPrivateFieldGet(
            this,
            _BetaToolRunner_message,
            "f",
          );
          const totalInputTokens =
            message.usage.input_tokens +
            (message.usage.cache_creation_input_tokens ?? 0) +
            (message.usage.cache_read_input_tokens ?? 0);
          tokensUsed = totalInputTokens + message.usage.output_tokens;
        } catch {
          return false;
        }
      }
      const threshold =
        compactionControl.contextTokenThreshold ?? DEFAULT_TOKEN_THRESHOLD;
      if (tokensUsed < threshold) {
        return false;
      }
      const model =
        compactionControl.model ??
        __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.model;
      const summaryPrompt =
        compactionControl.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;
      const messages = __classPrivateFieldGet(this, _BetaToolRunner_state, "f")
        .params.messages;
      if (messages[messages.length - 1].role === "assistant") {
        const lastMessage = messages[messages.length - 1];
        if (Array.isArray(lastMessage.content)) {
          const nonToolBlocks = lastMessage.content.filter(
            (block) => block.type !== "tool_use",
          );
          if (nonToolBlocks.length === 0) {
            messages.pop();
          } else {
            lastMessage.content = nonToolBlocks;
          }
        }
      }
      const response = await this.client.beta.messages.create(
        {
          model,
          messages: [
            ...messages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: summaryPrompt,
                },
              ],
            },
          ],
          max_tokens: __classPrivateFieldGet(this, _BetaToolRunner_state, "f")
            .params.max_tokens,
        },
        {
          headers: { "x-stainless-helper": "compaction" },
        },
      );
      if (response.content[0]?.type !== "text") {
        throw new AnthropicError("Expected text response for compaction");
      }
      __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.messages =
        [
          {
            role: "user",
            content: response.content,
          },
        ];
      return true;
    }),
  Symbol.asyncIterator)]() {
    var _a2;
    if (__classPrivateFieldGet(this, _BetaToolRunner_consumed, "f")) {
      throw new AnthropicError("Cannot iterate over a consumed stream");
    }
    __classPrivateFieldSet(this, _BetaToolRunner_consumed, true);
    __classPrivateFieldSet(this, _BetaToolRunner_mutated, true);
    __classPrivateFieldSet(this, _BetaToolRunner_toolResponse, void 0);
    try {
      while (true) {
        let stream;
        try {
          if (
            __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params
              .max_iterations &&
            __classPrivateFieldGet(this, _BetaToolRunner_iterationCount, "f") >=
              __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params
                .max_iterations
          ) {
            break;
          }
          __classPrivateFieldSet(this, _BetaToolRunner_mutated, false, "f");
          __classPrivateFieldSet(
            this,
            _BetaToolRunner_toolResponse,
            void 0,
            "f",
          );
          __classPrivateFieldSet(
            this,
            _BetaToolRunner_iterationCount,
            ((_a2 = __classPrivateFieldGet(
              this,
              _BetaToolRunner_iterationCount,
              "f",
            )),
            _a2++,
            _a2),
            "f",
          );
          __classPrivateFieldSet(this, _BetaToolRunner_message, void 0, "f");
          const { max_iterations, compactionControl, ...params } =
            __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params;
          if (params.stream) {
            stream = this.client.beta.messages.stream(
              { ...params },
              __classPrivateFieldGet(this, _BetaToolRunner_options, "f"),
            );
            __classPrivateFieldSet(
              this,
              _BetaToolRunner_message,
              stream.finalMessage(),
              "f",
            );
            __classPrivateFieldGet(this, _BetaToolRunner_message, "f").catch(
              () => {},
            );
            yield stream;
          } else {
            __classPrivateFieldSet(
              this,
              _BetaToolRunner_message,
              this.client.beta.messages.create(
                { ...params, stream: false },
                __classPrivateFieldGet(this, _BetaToolRunner_options, "f"),
              ),
              "f",
            );
            yield __classPrivateFieldGet(this, _BetaToolRunner_message, "f");
          }
          const isCompacted = await __classPrivateFieldGet(
            this,
            _BetaToolRunner_instances,
            "m",
            _BetaToolRunner_checkAndCompact,
          ).call(this);
          if (!isCompacted) {
            if (!__classPrivateFieldGet(this, _BetaToolRunner_mutated, "f")) {
              const { role, content } = await __classPrivateFieldGet(
                this,
                _BetaToolRunner_message,
                "f",
              );
              __classPrivateFieldGet(
                this,
                _BetaToolRunner_state,
                "f",
              ).params.messages.push({ role, content });
            }
            const toolMessage = await __classPrivateFieldGet(
              this,
              _BetaToolRunner_instances,
              "m",
              _BetaToolRunner_generateToolResponse,
            ).call(
              this,
              __classPrivateFieldGet(
                this,
                _BetaToolRunner_state,
                "f",
              ).params.messages.at(-1),
            );
            if (toolMessage) {
              __classPrivateFieldGet(
                this,
                _BetaToolRunner_state,
                "f",
              ).params.messages.push(toolMessage);
            } else if (
              !__classPrivateFieldGet(this, _BetaToolRunner_mutated, "f")
            ) {
              break;
            }
          }
        } finally {
          if (stream) {
            stream.abort();
          }
        }
      }
      if (!__classPrivateFieldGet(this, _BetaToolRunner_message, "f")) {
        throw new AnthropicError(
          "ToolRunner concluded without a message from the server",
        );
      }
      __classPrivateFieldGet(this, _BetaToolRunner_completion, "f").resolve(
        await __classPrivateFieldGet(this, _BetaToolRunner_message, "f"),
      );
    } catch (error) {
      __classPrivateFieldSet(this, _BetaToolRunner_consumed, false);
      __classPrivateFieldGet(
        this,
        _BetaToolRunner_completion,
        "f",
      ).promise.catch(() => {});
      __classPrivateFieldGet(this, _BetaToolRunner_completion, "f").reject(
        error,
      );
      __classPrivateFieldSet(
        this,
        _BetaToolRunner_completion,
        promiseWithResolvers(),
      );
      throw error;
    }
  }
  setMessagesParams(paramsOrMutator) {
    if (typeof paramsOrMutator === "function") {
      __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params =
        paramsOrMutator(
          __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params,
        );
    } else {
      __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params =
        paramsOrMutator;
    }
    __classPrivateFieldSet(this, _BetaToolRunner_mutated, true);
    __classPrivateFieldSet(this, _BetaToolRunner_toolResponse, void 0);
  }
  /**
   * Get the tool response for the last message from the assistant.
   * Avoids redundant tool executions by caching results.
   *
   * @returns A promise that resolves to a BetaMessageParam containing tool results, or null if no tools need to be executed
   *
   * @example
   * const toolResponse = await runner.generateToolResponse();
   * if (toolResponse) {
   *   console.log('Tool results:', toolResponse.content);
   * }
   */
  async generateToolResponse() {
    const message =
      (await __classPrivateFieldGet(this, _BetaToolRunner_message, "f")) ??
      this.params.messages.at(-1);
    if (!message) {
      return null;
    }
    return __classPrivateFieldGet(
      this,
      _BetaToolRunner_instances,
      "m",
      _BetaToolRunner_generateToolResponse,
    ).call(this, message);
  }
  /**
   * Wait for the async iterator to complete. This works even if the async iterator hasn't yet started, and
   * will wait for an instance to start and go to completion.
   *
   * @returns A promise that resolves to the final BetaMessage when the iterator completes
   *
   * @example
   * // Start consuming the iterator
   * for await (const message of runner) {
   *   console.log('Message:', message.content);
   * }
   *
   * // Meanwhile, wait for completion from another part of the code
   * const finalMessage = await runner.done();
   * console.log('Final response:', finalMessage.content);
   */
  done() {
    return __classPrivateFieldGet(this, _BetaToolRunner_completion, "f")
      .promise;
  }
  /**
   * Returns a promise indicating that the stream is done. Unlike .done(), this will eagerly read the stream:
   * * If the iterator has not been consumed, consume the entire iterator and return the final message from the
   * assistant.
   * * If the iterator has been consumed, waits for it to complete and returns the final message.
   *
   * @returns A promise that resolves to the final BetaMessage from the conversation
   * @throws {AnthropicError} If no messages were processed during the conversation
   *
   * @example
   * const finalMessage = await runner.runUntilDone();
   * console.log('Final response:', finalMessage.content);
   */
  async runUntilDone() {
    if (!__classPrivateFieldGet(this, _BetaToolRunner_consumed, "f")) {
      for await (const _ of this) {
      }
    }
    return this.done();
  }
  /**
   * Get the current parameters being used by the ToolRunner.
   *
   * @returns A readonly view of the current ToolRunnerParams
   *
   * @example
   * const currentParams = runner.params;
   * console.log('Current model:', currentParams.model);
   * console.log('Message count:', currentParams.messages.length);
   */
  get params() {
    return __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params;
  }
  /**
   * Add one or more messages to the conversation history.
   *
   * @param messages - One or more BetaMessageParam objects to add to the conversation
   *
   * @example
   * runner.pushMessages(
   *   { role: 'user', content: 'Also, what about the weather in NYC?' }
   * );
   *
   * @example
   * // Adding multiple messages
   * runner.pushMessages(
   *   { role: 'user', content: 'What about NYC?' },
   *   { role: 'user', content: 'And Boston?' }
   * );
   */
  pushMessages(...messages) {
    this.setMessagesParams((params) => ({
      ...params,
      messages: [...params.messages, ...messages],
    }));
  }
  /**
   * Makes the ToolRunner directly awaitable, equivalent to calling .runUntilDone()
   * This allows using `await runner` instead of `await runner.runUntilDone()`
   */
  then(onfulfilled, onrejected) {
    return this.runUntilDone().then(onfulfilled, onrejected);
  }
}
_BetaToolRunner_generateToolResponse =
  async function _BetaToolRunner_generateToolResponse2(lastMessage) {
    if (
      __classPrivateFieldGet(this, _BetaToolRunner_toolResponse, "f") !== void 0
    ) {
      return __classPrivateFieldGet(this, _BetaToolRunner_toolResponse, "f");
    }
    __classPrivateFieldSet(
      this,
      _BetaToolRunner_toolResponse,
      generateToolResponse(
        __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params,
        lastMessage,
      ),
    );
    return __classPrivateFieldGet(this, _BetaToolRunner_toolResponse, "f");
  };
async function generateToolResponse(
  params,
  lastMessage = params.messages.at(-1),
) {
  if (
    !lastMessage ||
    lastMessage.role !== "assistant" ||
    !lastMessage.content ||
    typeof lastMessage.content === "string"
  ) {
    return null;
  }
  const toolUseBlocks = lastMessage.content.filter(
    (content) => content.type === "tool_use",
  );
  if (toolUseBlocks.length === 0) {
    return null;
  }
  const toolResults = await Promise.all(
    toolUseBlocks.map(async (toolUse) => {
      const tool = params.tools.find(
        (t) => ("name" in t ? t.name : t.mcp_server_name) === toolUse.name,
      );
      if (!tool || !("run" in tool)) {
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: Tool '${toolUse.name}' not found`,
          is_error: true,
        };
      }
      try {
        let input = toolUse.input;
        if ("parse" in tool && tool.parse) {
          input = tool.parse(input);
        }
        const result = await tool.run(input);
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        };
      } catch (error) {
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content:
            error instanceof ToolError
              ? error.content
              : `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        };
      }
    }),
  );
  return {
    role: "user",
    content: toolResults,
  };
}
class JSONLDecoder {
  constructor(iterator, controller) {
    this.iterator = iterator;
    this.controller = controller;
  }
  async *decoder() {
    const lineDecoder = new LineDecoder();
    for await (const chunk of this.iterator) {
      for (const line of lineDecoder.decode(chunk)) {
        yield JSON.parse(line);
      }
    }
    for (const line of lineDecoder.flush()) {
      yield JSON.parse(line);
    }
  }
  [Symbol.asyncIterator]() {
    return this.decoder();
  }
  static fromResponse(response, controller) {
    if (!response.body) {
      controller.abort();
      if (
        typeof globalThis.navigator !== "undefined" &&
        globalThis.navigator.product === "ReactNative"
      ) {
        throw new AnthropicError(
          `The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`,
        );
      }
      throw new AnthropicError(
        `Attempted to iterate over a response with no body`,
      );
    }
    return new JSONLDecoder(
      ReadableStreamToAsyncIterable(response.body),
      controller,
    );
  }
}
let Batches$1 = class Batches extends APIResource {
  /**
   * Send a batch of Message creation requests.
   *
   * The Message Batches API can be used to process multiple Messages API requests at
   * once. Once a Message Batch is created, it begins processing immediately. Batches
   * can take up to 24 hours to complete.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.create({
   *     requests: [
   *       {
   *         custom_id: 'my-custom-id-1',
   *         params: {
   *           max_tokens: 1024,
   *           messages: [
   *             { content: 'Hello, world', role: 'user' },
   *           ],
   *           model: 'claude-opus-4-6',
   *         },
   *       },
   *     ],
   *   });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/messages/batches?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "message-batches-2024-09-24",
          ].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * This endpoint is idempotent and can be used to poll for Message Batch
   * completion. To access the results of a Message Batch, make a request to the
   * `results_url` field in the response.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.retrieve(
   *     'message_batch_id',
   *   );
   * ```
   */
  retrieve(messageBatchID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(
      path`/v1/messages/batches/${messageBatchID}?beta=true`,
      {
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "message-batches-2024-09-24",
            ].toString(),
          },
          options?.headers,
        ]),
      },
    );
  }
  /**
   * List all Message Batches within a Workspace. Most recently created batches are
   * returned first.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaMessageBatch of client.beta.messages.batches.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/messages/batches?beta=true", Page, {
      query,
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "message-batches-2024-09-24",
          ].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * Delete a Message Batch.
   *
   * Message Batches can only be deleted once they've finished processing. If you'd
   * like to delete an in-progress batch, you must first cancel it.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaDeletedMessageBatch =
   *   await client.beta.messages.batches.delete(
   *     'message_batch_id',
   *   );
   * ```
   */
  delete(messageBatchID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(
      path`/v1/messages/batches/${messageBatchID}?beta=true`,
      {
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "message-batches-2024-09-24",
            ].toString(),
          },
          options?.headers,
        ]),
      },
    );
  }
  /**
   * Batches may be canceled any time before processing ends. Once cancellation is
   * initiated, the batch enters a `canceling` state, at which time the system may
   * complete any in-progress, non-interruptible requests before finalizing
   * cancellation.
   *
   * The number of canceled requests is specified in `request_counts`. To determine
   * which requests were canceled, check the individual results within the batch.
   * Note that cancellation may not result in any canceled requests if they were
   * non-interruptible.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.cancel(
   *     'message_batch_id',
   *   );
   * ```
   */
  cancel(messageBatchID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(
      path`/v1/messages/batches/${messageBatchID}/cancel?beta=true`,
      {
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "message-batches-2024-09-24",
            ].toString(),
          },
          options?.headers,
        ]),
      },
    );
  }
  /**
   * Streams the results of a Message Batch as a `.jsonl` file.
   *
   * Each line in the file is a JSON object containing the result of a single request
   * in the Message Batch. Results are not guaranteed to be in the same order as
   * requests. Use the `custom_id` field to match results to requests.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatchIndividualResponse =
   *   await client.beta.messages.batches.results(
   *     'message_batch_id',
   *   );
   * ```
   */
  async results(messageBatchID, params = {}, options) {
    const batch = await this.retrieve(messageBatchID);
    if (!batch.results_url) {
      throw new AnthropicError(
        `No batch \`results_url\`; Has it finished processing? ${batch.processing_status} - ${batch.id}`,
      );
    }
    const { betas } = params ?? {};
    return this._client
      .get(batch.results_url, {
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "message-batches-2024-09-24",
            ].toString(),
            Accept: "application/binary",
          },
          options?.headers,
        ]),
        stream: true,
        __binaryResponse: true,
      })
      ._thenUnwrap((_, props) =>
        JSONLDecoder.fromResponse(props.response, props.controller),
      );
  }
};
const DEPRECATED_MODELS$1 = {
  "claude-1.3": "November 6th, 2024",
  "claude-1.3-100k": "November 6th, 2024",
  "claude-instant-1.1": "November 6th, 2024",
  "claude-instant-1.1-100k": "November 6th, 2024",
  "claude-instant-1.2": "November 6th, 2024",
  "claude-3-sonnet-20240229": "July 21st, 2025",
  "claude-3-opus-20240229": "January 5th, 2026",
  "claude-2.1": "July 21st, 2025",
  "claude-2.0": "July 21st, 2025",
  "claude-3-7-sonnet-latest": "February 19th, 2026",
  "claude-3-7-sonnet-20250219": "February 19th, 2026",
};
const MODELS_TO_WARN_WITH_THINKING_ENABLED$1 = ["claude-opus-4-6"];
let Messages$1 = class Messages extends APIResource {
  constructor() {
    super(...arguments);
    this.batches = new Batches$1(this._client);
  }
  create(params, options) {
    const modifiedParams = transformOutputFormat(params);
    const { betas, ...body } = modifiedParams;
    if (body.model in DEPRECATED_MODELS$1) {
      console.warn(`The model '${body.model}' is deprecated and will reach end-of-life on ${DEPRECATED_MODELS$1[body.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`);
    }
    if (
      body.model in MODELS_TO_WARN_WITH_THINKING_ENABLED$1 &&
      body.thinking &&
      body.thinking.type === "enabled"
    ) {
      console.warn(
        `Using Claude with ${body.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`,
      );
    }
    let timeout = this._client._options.timeout;
    if (!body.stream && timeout == null) {
      const maxNonstreamingTokens =
        MODEL_NONSTREAMING_TOKENS[body.model] ?? void 0;
      timeout = this._client.calculateNonstreamingTimeout(
        body.max_tokens,
        maxNonstreamingTokens,
      );
    }
    const helperHeader = stainlessHelperHeader(body.tools, body.messages);
    return this._client.post("/v1/messages?beta=true", {
      body,
      timeout: timeout ?? 6e5,
      ...options,
      headers: buildHeaders([
        {
          ...(betas?.toString() != null
            ? { "anthropic-beta": betas?.toString() }
            : void 0),
        },
        helperHeader,
        options?.headers,
      ]),
      stream: modifiedParams.stream ?? false,
    });
  }
  /**
   * Send a structured list of input messages with text and/or image content, along with an expected `output_format` and
   * the response will be automatically parsed and available in the `parsed_output` property of the message.
   *
   * @example
   * ```ts
   * const message = await client.beta.messages.parse({
   *   model: 'claude-3-5-sonnet-20241022',
   *   max_tokens: 1024,
   *   messages: [{ role: 'user', content: 'What is 2+2?' }],
   *   output_format: zodOutputFormat(z.object({ answer: z.number() }), 'math'),
   * });
   *
   * console.log(message.parsed_output?.answer); // 4
   * ```
   */
  parse(params, options) {
    options = {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(params.betas ?? []),
            "structured-outputs-2025-12-15",
          ].toString(),
        },
        options?.headers,
      ]),
    };
    return this.create(params, options).then((message) =>
      parseBetaMessage(message, params, {
        logger: this._client.logger ?? console,
      }),
    );
  }
  /**
   * Create a Message stream
   */
  stream(body, options) {
    return BetaMessageStream.createMessage(this, body, options);
  }
  /**
   * Count the number of tokens in a Message.
   *
   * The Token Count API can be used to count the number of tokens in a Message,
   * including tools, images, and documents, without creating it.
   *
   * Learn more about token counting in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/token-counting)
   *
   * @example
   * ```ts
   * const betaMessageTokensCount =
   *   await client.beta.messages.countTokens({
   *     messages: [{ content: 'string', role: 'user' }],
   *     model: 'claude-opus-4-6',
   *   });
   * ```
   */
  countTokens(params, options) {
    const modifiedParams = transformOutputFormat(params);
    const { betas, ...body } = modifiedParams;
    return this._client.post("/v1/messages/count_tokens?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [
            ...(betas ?? []),
            "token-counting-2024-11-01",
          ].toString(),
        },
        options?.headers,
      ]),
    });
  }
  toolRunner(body, options) {
    return new BetaToolRunner(this._client, body, options);
  }
};
function transformOutputFormat(params) {
  if (!params.output_format) {
    return params;
  }
  if (params.output_config?.format) {
    throw new AnthropicError(
      "Both output_format and output_config.format were provided. Please use only output_config.format (output_format is deprecated).",
    );
  }
  const { output_format, ...rest } = params;
  return {
    ...rest,
    output_config: {
      ...params.output_config,
      format: output_format,
    },
  };
}
Messages$1.Batches = Batches$1;
Messages$1.BetaToolRunner = BetaToolRunner;
Messages$1.ToolError = ToolError;
class Versions extends APIResource {
  /**
   * Create Skill Version
   *
   * @example
   * ```ts
   * const version = await client.beta.skills.versions.create(
   *   'skill_id',
   * );
   * ```
   */
  create(skillID, params = {}, options) {
    const { betas, ...body } = params ?? {};
    return this._client.post(
      path`/v1/skills/${skillID}/versions?beta=true`,
      multipartFormRequestOptions(
        {
          body,
          ...options,
          headers: buildHeaders([
            {
              "anthropic-beta": [
                ...(betas ?? []),
                "skills-2025-10-02",
              ].toString(),
            },
            options?.headers,
          ]),
        },
        this._client,
      ),
    );
  }
  /**
   * Get Skill Version
   *
   * @example
   * ```ts
   * const version = await client.beta.skills.versions.retrieve(
   *   'version',
   *   { skill_id: 'skill_id' },
   * );
   * ```
   */
  retrieve(version2, params, options) {
    const { skill_id, betas } = params;
    return this._client.get(
      path`/v1/skills/${skill_id}/versions/${version2}?beta=true`,
      {
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "skills-2025-10-02",
            ].toString(),
          },
          options?.headers,
        ]),
      },
    );
  }
  /**
   * List Skill Versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const versionListResponse of client.beta.skills.versions.list(
   *   'skill_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(skillID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(
      path`/v1/skills/${skillID}/versions?beta=true`,
      PageCursor,
      {
        query,
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "skills-2025-10-02",
            ].toString(),
          },
          options?.headers,
        ]),
      },
    );
  }
  /**
   * Delete Skill Version
   *
   * @example
   * ```ts
   * const version = await client.beta.skills.versions.delete(
   *   'version',
   *   { skill_id: 'skill_id' },
   * );
   * ```
   */
  delete(version2, params, options) {
    const { skill_id, betas } = params;
    return this._client.delete(
      path`/v1/skills/${skill_id}/versions/${version2}?beta=true`,
      {
        ...options,
        headers: buildHeaders([
          {
            "anthropic-beta": [
              ...(betas ?? []),
              "skills-2025-10-02",
            ].toString(),
          },
          options?.headers,
        ]),
      },
    );
  }
}
class Skills extends APIResource {
  constructor() {
    super(...arguments);
    this.versions = new Versions(this._client);
  }
  /**
   * Create Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.create();
   * ```
   */
  create(params = {}, options) {
    const { betas, ...body } = params ?? {};
    return this._client.post(
      "/v1/skills?beta=true",
      multipartFormRequestOptions(
        {
          body,
          ...options,
          headers: buildHeaders([
            {
              "anthropic-beta": [
                ...(betas ?? []),
                "skills-2025-10-02",
              ].toString(),
            },
            options?.headers,
          ]),
        },
        this._client,
        false,
      ),
    );
  }
  /**
   * Get Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.retrieve('skill_id');
   * ```
   */
  retrieve(skillID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/skills/${skillID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [...(betas ?? []), "skills-2025-10-02"].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * List Skills
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const skillListResponse of client.beta.skills.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/skills?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [...(betas ?? []), "skills-2025-10-02"].toString(),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * Delete Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.delete('skill_id');
   * ```
   */
  delete(skillID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/skills/${skillID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [...(betas ?? []), "skills-2025-10-02"].toString(),
        },
        options?.headers,
      ]),
    });
  }
}
Skills.Versions = Versions;
class Beta extends APIResource {
  constructor() {
    super(...arguments);
    this.models = new Models$1(this._client);
    this.messages = new Messages$1(this._client);
    this.files = new Files(this._client);
    this.skills = new Skills(this._client);
  }
}
Beta.Models = Models$1;
Beta.Messages = Messages$1;
Beta.Files = Files;
Beta.Skills = Skills;
class Completions extends APIResource {
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/complete", {
      body,
      timeout: this._client._options.timeout ?? 6e5,
      ...options,
      headers: buildHeaders([
        {
          ...(betas?.toString() != null
            ? { "anthropic-beta": betas?.toString() }
            : void 0),
        },
        options?.headers,
      ]),
      stream: params.stream ?? false,
    });
  }
}
function getOutputFormat(params) {
  return params?.output_config?.format;
}
function maybeParseMessage(message, params, opts) {
  const outputFormat = getOutputFormat(params);
  if (!params || !("parse" in (outputFormat ?? {}))) {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "text") {
          const parsedBlock = Object.defineProperty(
            { ...block },
            "parsed_output",
            {
              value: null,
              enumerable: false,
            },
          );
          return parsedBlock;
        }
        return block;
      }),
      parsed_output: null,
    };
  }
  return parseMessage(message, params);
}
function parseMessage(message, params, opts) {
  let firstParsedOutput = null;
  const content = message.content.map((block) => {
    if (block.type === "text") {
      const parsedOutput = parseOutputFormat(params, block.text);
      if (firstParsedOutput === null) {
        firstParsedOutput = parsedOutput;
      }
      const parsedBlock = Object.defineProperty({ ...block }, "parsed_output", {
        value: parsedOutput,
        enumerable: false,
      });
      return parsedBlock;
    }
    return block;
  });
  return {
    ...message,
    content,
    parsed_output: firstParsedOutput,
  };
}
function parseOutputFormat(params, content) {
  const outputFormat = getOutputFormat(params);
  if (outputFormat?.type !== "json_schema") {
    return null;
  }
  try {
    if ("parse" in outputFormat) {
      return outputFormat.parse(content);
    }
    return JSON.parse(content);
  } catch (error) {
    throw new AnthropicError(`Failed to parse structured output: ${error}`);
  }
}
var _MessageStream_instances,
  _MessageStream_currentMessageSnapshot,
  _MessageStream_params,
  _MessageStream_connectedPromise,
  _MessageStream_resolveConnectedPromise,
  _MessageStream_rejectConnectedPromise,
  _MessageStream_endPromise,
  _MessageStream_resolveEndPromise,
  _MessageStream_rejectEndPromise,
  _MessageStream_listeners,
  _MessageStream_ended,
  _MessageStream_errored,
  _MessageStream_aborted,
  _MessageStream_catchingPromiseCreated,
  _MessageStream_response,
  _MessageStream_request_id,
  _MessageStream_logger,
  _MessageStream_getFinalMessage,
  _MessageStream_getFinalText,
  _MessageStream_handleError,
  _MessageStream_beginRequest,
  _MessageStream_addStreamEvent,
  _MessageStream_endRequest,
  _MessageStream_accumulateMessage;
const JSON_BUF_PROPERTY = "__json_buf";
function tracksToolInput(content) {
  return content.type === "tool_use" || content.type === "server_tool_use";
}
class MessageStream {
  constructor(params, opts) {
    _MessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _MessageStream_currentMessageSnapshot.set(this, void 0);
    _MessageStream_params.set(this, null);
    this.controller = new AbortController();
    _MessageStream_connectedPromise.set(this, void 0);
    _MessageStream_resolveConnectedPromise.set(this, () => {});
    _MessageStream_rejectConnectedPromise.set(this, () => {});
    _MessageStream_endPromise.set(this, void 0);
    _MessageStream_resolveEndPromise.set(this, () => {});
    _MessageStream_rejectEndPromise.set(this, () => {});
    _MessageStream_listeners.set(this, {});
    _MessageStream_ended.set(this, false);
    _MessageStream_errored.set(this, false);
    _MessageStream_aborted.set(this, false);
    _MessageStream_catchingPromiseCreated.set(this, false);
    _MessageStream_response.set(this, void 0);
    _MessageStream_request_id.set(this, void 0);
    _MessageStream_logger.set(this, void 0);
    _MessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet(this, _MessageStream_errored, true);
      if (isAbortError(error)) {
        error = new APIUserAbortError();
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet(this, _MessageStream_aborted, true);
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError = new AnthropicError(error.message);
        anthropicError.cause = error;
        return this._emit("error", anthropicError);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet(
      this,
      _MessageStream_connectedPromise,
      new Promise((resolve, reject) => {
        __classPrivateFieldSet(
          this,
          _MessageStream_resolveConnectedPromise,
          resolve,
          "f",
        );
        __classPrivateFieldSet(
          this,
          _MessageStream_rejectConnectedPromise,
          reject,
          "f",
        );
      }),
    );
    __classPrivateFieldSet(
      this,
      _MessageStream_endPromise,
      new Promise((resolve, reject) => {
        __classPrivateFieldSet(
          this,
          _MessageStream_resolveEndPromise,
          resolve,
          "f",
        );
        __classPrivateFieldSet(
          this,
          _MessageStream_rejectEndPromise,
          reject,
          "f",
        );
      }),
    );
    __classPrivateFieldGet(this, _MessageStream_connectedPromise, "f").catch(
      () => {},
    );
    __classPrivateFieldGet(this, _MessageStream_endPromise, "f").catch(
      () => {},
    );
    __classPrivateFieldSet(this, _MessageStream_params, params);
    __classPrivateFieldSet(
      this,
      _MessageStream_logger,
      opts?.logger ?? console,
    );
  }
  get response() {
    return __classPrivateFieldGet(this, _MessageStream_response, "f");
  }
  get request_id() {
    return __classPrivateFieldGet(this, _MessageStream_request_id, "f");
  }
  /**
   * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
   * returned vie the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * This is the same as the `APIPromise.withResponse()` method.
   *
   * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
   * as no `Response` is available.
   */
  async withResponse() {
    __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true);
    const response = await __classPrivateFieldGet(
      this,
      _MessageStream_connectedPromise,
      "f",
    );
    if (!response) {
      throw new Error("Could not resolve a `Response` object");
    }
    return {
      data: this,
      response,
      request_id: response.headers.get("request-id"),
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new MessageStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options, { logger } = {}) {
    const runner = new MessageStream(params, { logger });
    for (const message of params.messages) {
      runner._addMessageParam(message);
    }
    __classPrivateFieldSet(runner, _MessageStream_params, {
      ...params,
      stream: true,
    });
    runner._run(() =>
      runner._createMessage(
        messages,
        { ...params, stream: true },
        {
          ...options,
          headers: {
            ...options?.headers,
            "X-Stainless-Helper-Method": "stream",
          },
        },
      ),
    );
    return runner;
  }
  _run(executor) {
    executor().then(
      () => {
        this._emitFinal();
        this._emit("end");
      },
      __classPrivateFieldGet(this, _MessageStream_handleError, "f"),
    );
  }
  _addMessageParam(message) {
    this.messages.push(message);
  }
  _addMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createMessage(messages, params, options) {
    const signal = options?.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(
        this,
        _MessageStream_instances,
        "m",
        _MessageStream_beginRequest,
      ).call(this);
      const { response, data: stream } = await messages
        .create(
          { ...params, stream: true },
          { ...options, signal: this.controller.signal },
        )
        .withResponse();
      this._connected(response);
      for await (const event of stream) {
        __classPrivateFieldGet(
          this,
          _MessageStream_instances,
          "m",
          _MessageStream_addStreamEvent,
        ).call(this, event);
      }
      if (stream.controller.signal?.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(
        this,
        _MessageStream_instances,
        "m",
        _MessageStream_endRequest,
      ).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  _connected(response) {
    if (this.ended) return;
    __classPrivateFieldSet(this, _MessageStream_response, response);
    __classPrivateFieldSet(
      this,
      _MessageStream_request_id,
      response?.headers.get("request-id"),
    );
    __classPrivateFieldGet(
      this,
      _MessageStream_resolveConnectedPromise,
      "f",
    ).call(this, response);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet(this, _MessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet(this, _MessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet(this, _MessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this MessageStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners2 =
      __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] ||
      (__classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = []);
    listeners2.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners2 = __classPrivateFieldGet(
      this,
      _MessageStream_listeners,
      "f",
    )[event];
    if (!listeners2) return this;
    const index = listeners2.findIndex((l) => l.listener === listener);
    if (index >= 0) listeners2.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners2 =
      __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] ||
      (__classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = []);
    listeners2.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true);
      if (event !== "error") this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true);
    await __classPrivateFieldGet(this, _MessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet(
      this,
      _MessageStream_currentMessageSnapshot,
      "f",
    );
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   * If structured outputs were used, this will be a ParsedMessage with a `parsed_output` field.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(
      this,
      _MessageStream_instances,
      "m",
      _MessageStream_getFinalMessage,
    ).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    await this.done();
    return __classPrivateFieldGet(
      this,
      _MessageStream_instances,
      "m",
      _MessageStream_getFinalText,
    ).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _MessageStream_ended, "f")) return;
    if (event === "end") {
      __classPrivateFieldSet(this, _MessageStream_ended, true);
      __classPrivateFieldGet(this, _MessageStream_resolveEndPromise, "f").call(
        this,
      );
    }
    const listeners2 = __classPrivateFieldGet(
      this,
      _MessageStream_listeners,
      "f",
    )[event];
    if (listeners2) {
      __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] =
        listeners2.filter((l) => !l.once);
      listeners2.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (
        !__classPrivateFieldGet(
          this,
          _MessageStream_catchingPromiseCreated,
          "f",
        ) &&
        !listeners2?.length
      ) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(
        this,
        _MessageStream_rejectConnectedPromise,
        "f",
      ).call(this, error);
      __classPrivateFieldGet(this, _MessageStream_rejectEndPromise, "f").call(
        this,
        error,
      );
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (
        !__classPrivateFieldGet(
          this,
          _MessageStream_catchingPromiseCreated,
          "f",
        ) &&
        !listeners2?.length
      ) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(
        this,
        _MessageStream_rejectConnectedPromise,
        "f",
      ).call(this, error);
      __classPrivateFieldGet(this, _MessageStream_rejectEndPromise, "f").call(
        this,
        error,
      );
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalMessage = this.receivedMessages.at(-1);
    if (finalMessage) {
      this._emit(
        "finalMessage",
        __classPrivateFieldGet(
          this,
          _MessageStream_instances,
          "m",
          _MessageStream_getFinalMessage,
        ).call(this),
      );
    }
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(
        this,
        _MessageStream_instances,
        "m",
        _MessageStream_beginRequest,
      ).call(this);
      this._connected(null);
      const stream = Stream.fromReadableStream(readableStream, this.controller);
      for await (const event of stream) {
        __classPrivateFieldGet(
          this,
          _MessageStream_instances,
          "m",
          _MessageStream_addStreamEvent,
        ).call(this, event);
      }
      if (stream.controller.signal?.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(
        this,
        _MessageStream_instances,
        "m",
        _MessageStream_endRequest,
      ).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  [((_MessageStream_currentMessageSnapshot = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_params = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_connectedPromise = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_endPromise = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_resolveEndPromise = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_rejectEndPromise = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_listeners = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_ended = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_errored = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_aborted = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_response = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_request_id = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_logger = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_handleError = /* @__PURE__ */ new WeakMap()),
  (_MessageStream_instances = /* @__PURE__ */ new WeakSet()),
  (_MessageStream_getFinalMessage = function _MessageStream_getFinalMessage2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError(
        "stream ended without producing a Message with role=assistant",
      );
    }
    return this.receivedMessages.at(-1);
  }),
  (_MessageStream_getFinalText = function _MessageStream_getFinalText2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError(
        "stream ended without producing a Message with role=assistant",
      );
    }
    const textBlocks = this.receivedMessages
      .at(-1)
      .content.filter((block) => block.type === "text")
      .map((block) => block.text);
    if (textBlocks.length === 0) {
      throw new AnthropicError(
        "stream ended without producing a content block with type=text",
      );
    }
    return textBlocks.join(" ");
  }),
  (_MessageStream_beginRequest = function _MessageStream_beginRequest2() {
    if (this.ended) return;
    __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, void 0);
  }),
  (_MessageStream_addStreamEvent = function _MessageStream_addStreamEvent2(
    event,
  ) {
    if (this.ended) return;
    const messageSnapshot = __classPrivateFieldGet(
      this,
      _MessageStream_instances,
      "m",
      _MessageStream_accumulateMessage,
    ).call(this, event);
    this._emit("streamEvent", event, messageSnapshot);
    switch (event.type) {
      case "content_block_delta": {
        const content = messageSnapshot.content.at(-1);
        switch (event.delta.type) {
          case "text_delta": {
            if (content.type === "text") {
              this._emit("text", event.delta.text, content.text || "");
            }
            break;
          }
          case "citations_delta": {
            if (content.type === "text") {
              this._emit(
                "citation",
                event.delta.citation,
                content.citations ?? [],
              );
            }
            break;
          }
          case "input_json_delta": {
            if (tracksToolInput(content) && content.input) {
              this._emit("inputJson", event.delta.partial_json, content.input);
            }
            break;
          }
          case "thinking_delta": {
            if (content.type === "thinking") {
              this._emit("thinking", event.delta.thinking, content.thinking);
            }
            break;
          }
          case "signature_delta": {
            if (content.type === "thinking") {
              this._emit("signature", content.signature);
            }
            break;
          }
          default:
            checkNever(event.delta);
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(messageSnapshot);
        this._addMessage(
          maybeParseMessage(
            messageSnapshot,
            __classPrivateFieldGet(this, _MessageStream_params, "f"),
            {
              logger: __classPrivateFieldGet(this, _MessageStream_logger, "f"),
            },
          ),
          true,
        );
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", messageSnapshot.content.at(-1));
        break;
      }
      case "message_start": {
        __classPrivateFieldSet(
          this,
          _MessageStream_currentMessageSnapshot,
          messageSnapshot,
        );
        break;
      }
    }
  }),
  (_MessageStream_endRequest = function _MessageStream_endRequest2() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(
      this,
      _MessageStream_currentMessageSnapshot,
      "f",
    );
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, void 0);
    return maybeParseMessage(
      snapshot,
      __classPrivateFieldGet(this, _MessageStream_params, "f"),
      { logger: __classPrivateFieldGet(this, _MessageStream_logger, "f") },
    );
  }),
  (_MessageStream_accumulateMessage =
    function _MessageStream_accumulateMessage2(event) {
      let snapshot = __classPrivateFieldGet(
        this,
        _MessageStream_currentMessageSnapshot,
        "f",
      );
      if (event.type === "message_start") {
        if (snapshot) {
          throw new AnthropicError(
            `Unexpected event order, got ${event.type} before receiving "message_stop"`,
          );
        }
        return event.message;
      }
      if (!snapshot) {
        throw new AnthropicError(
          `Unexpected event order, got ${event.type} before "message_start"`,
        );
      }
      switch (event.type) {
        case "message_stop":
          return snapshot;
        case "message_delta":
          snapshot.stop_reason = event.delta.stop_reason;
          snapshot.stop_sequence = event.delta.stop_sequence;
          snapshot.usage.output_tokens = event.usage.output_tokens;
          if (event.usage.input_tokens != null) {
            snapshot.usage.input_tokens = event.usage.input_tokens;
          }
          if (event.usage.cache_creation_input_tokens != null) {
            snapshot.usage.cache_creation_input_tokens =
              event.usage.cache_creation_input_tokens;
          }
          if (event.usage.cache_read_input_tokens != null) {
            snapshot.usage.cache_read_input_tokens =
              event.usage.cache_read_input_tokens;
          }
          if (event.usage.server_tool_use != null) {
            snapshot.usage.server_tool_use = event.usage.server_tool_use;
          }
          return snapshot;
        case "content_block_start":
          snapshot.content.push({ ...event.content_block });
          return snapshot;
        case "content_block_delta": {
          const snapshotContent = snapshot.content.at(event.index);
          switch (event.delta.type) {
            case "text_delta": {
              if (snapshotContent?.type === "text") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  text: (snapshotContent.text || "") + event.delta.text,
                };
              }
              break;
            }
            case "citations_delta": {
              if (snapshotContent?.type === "text") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  citations: [
                    ...(snapshotContent.citations ?? []),
                    event.delta.citation,
                  ],
                };
              }
              break;
            }
            case "input_json_delta": {
              if (snapshotContent && tracksToolInput(snapshotContent)) {
                let jsonBuf = snapshotContent[JSON_BUF_PROPERTY] || "";
                jsonBuf += event.delta.partial_json;
                const newContent = { ...snapshotContent };
                Object.defineProperty(newContent, JSON_BUF_PROPERTY, {
                  value: jsonBuf,
                  enumerable: false,
                  writable: true,
                });
                if (jsonBuf) {
                  newContent.input = partialParse(jsonBuf);
                }
                snapshot.content[event.index] = newContent;
              }
              break;
            }
            case "thinking_delta": {
              if (snapshotContent?.type === "thinking") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  thinking: snapshotContent.thinking + event.delta.thinking,
                };
              }
              break;
            }
            case "signature_delta": {
              if (snapshotContent?.type === "thinking") {
                snapshot.content[event.index] = {
                  ...snapshotContent,
                  signature: event.delta.signature,
                };
              }
              break;
            }
            default:
              checkNever(event.delta);
          }
          return snapshot;
        }
        case "content_block_stop":
          return snapshot;
      }
    }),
  Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) =>
            readQueue.push({ resolve, reject }),
          ).then((chunk2) =>
            chunk2
              ? { value: chunk2, done: false }
              : { value: void 0, done: true },
          );
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      },
    };
  }
  toReadableStream() {
    const stream = new Stream(
      this[Symbol.asyncIterator].bind(this),
      this.controller,
    );
    return stream.toReadableStream();
  }
}
function checkNever(x) {}
class Batches2 extends APIResource {
  /**
   * Send a batch of Message creation requests.
   *
   * The Message Batches API can be used to process multiple Messages API requests at
   * once. Once a Message Batch is created, it begins processing immediately. Batches
   * can take up to 24 hours to complete.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.create({
   *   requests: [
   *     {
   *       custom_id: 'my-custom-id-1',
   *       params: {
   *         max_tokens: 1024,
   *         messages: [
   *           { content: 'Hello, world', role: 'user' },
   *         ],
   *         model: 'claude-opus-4-6',
   *       },
   *     },
   *   ],
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/v1/messages/batches", { body, ...options });
  }
  /**
   * This endpoint is idempotent and can be used to poll for Message Batch
   * completion. To access the results of a Message Batch, make a request to the
   * `results_url` field in the response.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.retrieve(
   *   'message_batch_id',
   * );
   * ```
   */
  retrieve(messageBatchID, options) {
    return this._client.get(
      path`/v1/messages/batches/${messageBatchID}`,
      options,
    );
  }
  /**
   * List all Message Batches within a Workspace. Most recently created batches are
   * returned first.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const messageBatch of client.messages.batches.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/v1/messages/batches", Page, {
      query,
      ...options,
    });
  }
  /**
   * Delete a Message Batch.
   *
   * Message Batches can only be deleted once they've finished processing. If you'd
   * like to delete an in-progress batch, you must first cancel it.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const deletedMessageBatch =
   *   await client.messages.batches.delete('message_batch_id');
   * ```
   */
  delete(messageBatchID, options) {
    return this._client.delete(
      path`/v1/messages/batches/${messageBatchID}`,
      options,
    );
  }
  /**
   * Batches may be canceled any time before processing ends. Once cancellation is
   * initiated, the batch enters a `canceling` state, at which time the system may
   * complete any in-progress, non-interruptible requests before finalizing
   * cancellation.
   *
   * The number of canceled requests is specified in `request_counts`. To determine
   * which requests were canceled, check the individual results within the batch.
   * Note that cancellation may not result in any canceled requests if they were
   * non-interruptible.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.cancel(
   *   'message_batch_id',
   * );
   * ```
   */
  cancel(messageBatchID, options) {
    return this._client.post(
      path`/v1/messages/batches/${messageBatchID}/cancel`,
      options,
    );
  }
  /**
   * Streams the results of a Message Batch as a `.jsonl` file.
   *
   * Each line in the file is a JSON object containing the result of a single request
   * in the Message Batch. Results are not guaranteed to be in the same order as
   * requests. Use the `custom_id` field to match results to requests.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatchIndividualResponse =
   *   await client.messages.batches.results('message_batch_id');
   * ```
   */
  async results(messageBatchID, options) {
    const batch = await this.retrieve(messageBatchID);
    if (!batch.results_url) {
      throw new AnthropicError(
        `No batch \`results_url\`; Has it finished processing? ${batch.processing_status} - ${batch.id}`,
      );
    }
    return this._client
      .get(batch.results_url, {
        ...options,
        headers: buildHeaders([
          { Accept: "application/binary" },
          options?.headers,
        ]),
        stream: true,
        __binaryResponse: true,
      })
      ._thenUnwrap((_, props) =>
        JSONLDecoder.fromResponse(props.response, props.controller),
      );
  }
}
class Messages2 extends APIResource {
  constructor() {
    super(...arguments);
    this.batches = new Batches2(this._client);
  }
  create(body, options) {
    if (body.model in DEPRECATED_MODELS) {
      console.warn(`The model '${body.model}' is deprecated and will reach end-of-life on ${DEPRECATED_MODELS[body.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`);
    }
    if (
      body.model in MODELS_TO_WARN_WITH_THINKING_ENABLED &&
      body.thinking &&
      body.thinking.type === "enabled"
    ) {
      console.warn(
        `Using Claude with ${body.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`,
      );
    }
    let timeout = this._client._options.timeout;
    if (!body.stream && timeout == null) {
      const maxNonstreamingTokens =
        MODEL_NONSTREAMING_TOKENS[body.model] ?? void 0;
      timeout = this._client.calculateNonstreamingTimeout(
        body.max_tokens,
        maxNonstreamingTokens,
      );
    }
    const helperHeader = stainlessHelperHeader(body.tools, body.messages);
    return this._client.post("/v1/messages", {
      body,
      timeout: timeout ?? 6e5,
      ...options,
      headers: buildHeaders([helperHeader, options?.headers]),
      stream: body.stream ?? false,
    });
  }
  /**
   * Send a structured list of input messages with text and/or image content, along with an expected `output_config.format` and
   * the response will be automatically parsed and available in the `parsed_output` property of the message.
   *
   * @example
   * ```ts
   * const message = await client.messages.parse({
   *   model: 'claude-sonnet-4-5-20250929',
   *   max_tokens: 1024,
   *   messages: [{ role: 'user', content: 'What is 2+2?' }],
   *   output_config: {
   *     format: zodOutputFormat(z.object({ answer: z.number() })),
   *   },
   * });
   *
   * console.log(message.parsed_output?.answer); // 4
   * ```
   */
  parse(params, options) {
    return this.create(params, options).then((message) =>
      parseMessage(message, params, { logger: this._client.logger ?? console }),
    );
  }
  /**
   * Create a Message stream.
   *
   * If `output_config.format` is provided with a parseable format (like `zodOutputFormat()`),
   * the final message will include a `parsed_output` property with the parsed content.
   *
   * @example
   * ```ts
   * const stream = client.messages.stream({
   *   model: 'claude-sonnet-4-5-20250929',
   *   max_tokens: 1024,
   *   messages: [{ role: 'user', content: 'What is 2+2?' }],
   *   output_config: {
   *     format: zodOutputFormat(z.object({ answer: z.number() })),
   *   },
   * });
   *
   * const message = await stream.finalMessage();
   * console.log(message.parsed_output?.answer); // 4
   * ```
   */
  stream(body, options) {
    return MessageStream.createMessage(this, body, options, {
      logger: this._client.logger ?? console,
    });
  }
  /**
   * Count the number of tokens in a Message.
   *
   * The Token Count API can be used to count the number of tokens in a Message,
   * including tools, images, and documents, without creating it.
   *
   * Learn more about token counting in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/token-counting)
   *
   * @example
   * ```ts
   * const messageTokensCount =
   *   await client.messages.countTokens({
   *     messages: [{ content: 'string', role: 'user' }],
   *     model: 'claude-opus-4-6',
   *   });
   * ```
   */
  countTokens(body, options) {
    return this._client.post("/v1/messages/count_tokens", { body, ...options });
  }
}
const DEPRECATED_MODELS = {
  "claude-1.3": "November 6th, 2024",
  "claude-1.3-100k": "November 6th, 2024",
  "claude-instant-1.1": "November 6th, 2024",
  "claude-instant-1.1-100k": "November 6th, 2024",
  "claude-instant-1.2": "November 6th, 2024",
  "claude-3-sonnet-20240229": "July 21st, 2025",
  "claude-3-opus-20240229": "January 5th, 2026",
  "claude-2.1": "July 21st, 2025",
  "claude-2.0": "July 21st, 2025",
  "claude-3-7-sonnet-latest": "February 19th, 2026",
  "claude-3-7-sonnet-20250219": "February 19th, 2026",
  "claude-3-5-haiku-latest": "February 19th, 2026",
  "claude-3-5-haiku-20241022": "February 19th, 2026",
};
const MODELS_TO_WARN_WITH_THINKING_ENABLED = ["claude-opus-4-6"];
Messages2.Batches = Batches2;
class Models2 extends APIResource {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   */
  retrieve(modelID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/models/${modelID}`, {
      ...options,
      headers: buildHeaders([
        {
          ...(betas?.toString() != null
            ? { "anthropic-beta": betas?.toString() }
            : void 0),
        },
        options?.headers,
      ]),
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/models", Page, {
      query,
      ...options,
      headers: buildHeaders([
        {
          ...(betas?.toString() != null
            ? { "anthropic-beta": betas?.toString() }
            : void 0),
        },
        options?.headers,
      ]),
    });
  }
}
const readEnv = (env) => {
  if (typeof globalThis.process !== "undefined") {
    return globalThis.process.env?.[env]?.trim() ?? void 0;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return globalThis.Deno.env?.get?.(env)?.trim();
  }
  return void 0;
};
var _BaseAnthropic_instances,
  _a,
  _BaseAnthropic_encoder,
  _BaseAnthropic_baseURLOverridden;
const HUMAN_PROMPT = "\\n\\nHuman:";
const AI_PROMPT = "\\n\\nAssistant:";
class BaseAnthropic {
  /**
   * API Client for interfacing with the Anthropic API.
   *
   * @param {string | null | undefined} [opts.apiKey=process.env['ANTHROPIC_API_KEY'] ?? null]
   * @param {string | null | undefined} [opts.authToken=process.env['ANTHROPIC_AUTH_TOKEN'] ?? null]
   * @param {string} [opts.baseURL=process.env['ANTHROPIC_BASE_URL'] ?? https://api.anthropic.com] - Override the default base URL for the API.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({
    baseURL = readEnv("ANTHROPIC_BASE_URL"),
    apiKey = readEnv("ANTHROPIC_API_KEY") ?? null,
    authToken = readEnv("ANTHROPIC_AUTH_TOKEN") ?? null,
    ...opts
  } = {}) {
    _BaseAnthropic_instances.add(this);
    _BaseAnthropic_encoder.set(this, void 0);
    const options = {
      apiKey,
      authToken,
      ...opts,
      baseURL: baseURL || `https://api.anthropic.com`,
    };
    if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new AnthropicError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew Anthropic({ apiKey, dangerouslyAllowBrowser: true });\n",
      );
    }
    this.baseURL = options.baseURL;
    this.timeout = options.timeout ?? _a.DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;
    const defaultLogLevel = "warn";
    this.logLevel = defaultLogLevel;
    this.logLevel =
      parseLogLevel(options.logLevel, "ClientOptions.logLevel", this) ??
      parseLogLevel(
        readEnv("ANTHROPIC_LOG"),
        "process.env['ANTHROPIC_LOG']",
        this,
      ) ??
      defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? getDefaultFetch();
    __classPrivateFieldSet(this, _BaseAnthropic_encoder, FallbackEncoder);
    this._options = options;
    this.apiKey = typeof apiKey === "string" ? apiKey : null;
    this.authToken = authToken;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options) {
    const client = new this.constructor({
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this.apiKey,
      authToken: this.authToken,
      ...options,
    });
    return client;
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values, nulls }) {
    if (values.get("x-api-key") || values.get("authorization")) {
      return;
    }
    if (this.apiKey && values.get("x-api-key")) {
      return;
    }
    if (nulls.has("x-api-key")) {
      return;
    }
    if (this.authToken && values.get("authorization")) {
      return;
    }
    if (nulls.has("authorization")) {
      return;
    }
    throw new Error(
      'Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted',
    );
  }
  async authHeaders(opts) {
    return buildHeaders([
      await this.apiKeyAuth(opts),
      await this.bearerAuth(opts),
    ]);
  }
  async apiKeyAuth(opts) {
    if (this.apiKey == null) {
      return void 0;
    }
    return buildHeaders([{ "X-Api-Key": this.apiKey }]);
  }
  async bearerAuth(opts) {
    if (this.authToken == null) {
      return void 0;
    }
    return buildHeaders([{ Authorization: `Bearer ${this.authToken}` }]);
  }
  /**
   * Basic re-implementation of `qs.stringify` for primitive types.
   */
  stringifyQuery(query) {
    return stringifyQuery(query);
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  buildURL(path2, query, defaultBaseURL) {
    const baseURL =
      (!__classPrivateFieldGet(
        this,
        _BaseAnthropic_instances,
        "m",
        _BaseAnthropic_baseURLOverridden,
      ).call(this) &&
        defaultBaseURL) ||
      this.baseURL;
    const url = isAbsoluteURL(path2)
      ? new URL(path2)
      : new URL(
          baseURL +
            (baseURL.endsWith("/") && path2.startsWith("/")
              ? path2.slice(1)
              : path2),
        );
    const defaultQuery = this.defaultQuery();
    const pathQuery = Object.fromEntries(url.searchParams);
    if (!isEmptyObj(defaultQuery) || !isEmptyObj(pathQuery)) {
      query = { ...pathQuery, ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  _calculateNonstreamingTimeout(maxTokens) {
    const defaultTimeout = 10 * 60;
    const expectedTimeout = (60 * 60 * maxTokens) / 128e3;
    if (expectedTimeout > defaultTimeout) {
      throw new AnthropicError(
        "Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#streaming-responses for more details",
      );
    }
    return defaultTimeout * 1e3;
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(options) {}
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url, options }) {}
  get(path2, opts) {
    return this.methodRequest("get", path2, opts);
  }
  post(path2, opts) {
    return this.methodRequest("post", path2, opts);
  }
  patch(path2, opts) {
    return this.methodRequest("patch", path2, opts);
  }
  put(path2, opts) {
    return this.methodRequest("put", path2, opts);
  }
  delete(path2, opts) {
    return this.methodRequest("delete", path2, opts);
  }
  methodRequest(method, path2, opts) {
    return this.request(
      Promise.resolve(opts).then((opts2) => {
        return { method, path: path2, ...opts2 };
      }),
    );
  }
  request(options, remainingRetries = null) {
    return new APIPromise(
      this,
      this.makeRequest(options, remainingRetries, void 0),
    );
  }
  async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    await this.prepareOptions(options);
    const { req, url, timeout } = await this.buildRequest(options, {
      retryCount: maxRetries - retriesRemaining,
    });
    await this.prepareRequest(req, { url, options });
    const requestLogID =
      "log_" + ((Math.random() * (1 << 24)) | 0).toString(16).padStart(6, "0");
    const retryLogStr =
      retryOfRequestLogID === void 0 ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = Date.now();
    loggerFor(this).debug(
      `[${requestLogID}] sending request`,
      formatRequestDetails({
        retryOfRequestLogID,
        method: options.method,
        url,
        options,
        headers: req.headers,
      }),
    );
    if (options.signal?.aborted) {
      throw new APIUserAbortError();
    }
    const controller = new AbortController();
    const response = await this.fetchWithTimeout(
      url,
      req,
      timeout,
      controller,
    ).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (options.signal?.aborted) {
        throw new APIUserAbortError();
      }
      const isTimeout =
        isAbortError(response) ||
        /timed? ?out/i.test(
          String(response) +
            ("cause" in response ? String(response.cause) : ""),
        );
      if (retriesRemaining) {
        loggerFor(this).info(
          `[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${retryMessage}`,
        );
        loggerFor(this).debug(
          `[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${retryMessage})`,
          formatRequestDetails({
            retryOfRequestLogID,
            url,
            durationMs: headersTime - startTime,
            message: response.message,
          }),
        );
        return this.retryRequest(
          options,
          retriesRemaining,
          retryOfRequestLogID ?? requestLogID,
        );
      }
      loggerFor(this).info(
        `[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - error; no more retries left`,
      );
      loggerFor(this).debug(
        `[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (error; no more retries left)`,
        formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: response.message,
        }),
      );
      if (isTimeout) {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const specialHeaders = [...response.headers.entries()]
      .filter(([name]) => name === "request-id")
      .map(([name, value]) => ", " + name + ": " + JSON.stringify(value))
      .join("");
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      const shouldRetry = await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        await CancelReadableStream(response.body);
        loggerFor(this).info(`${responseInfo} - ${retryMessage2}`);
        loggerFor(this).debug(
          `[${requestLogID}] response error (${retryMessage2})`,
          formatRequestDetails({
            retryOfRequestLogID,
            url: response.url,
            status: response.status,
            headers: response.headers,
            durationMs: headersTime - startTime,
          }),
        );
        return this.retryRequest(
          options,
          retriesRemaining,
          retryOfRequestLogID ?? requestLogID,
          response.headers,
        );
      }
      const retryMessage = shouldRetry
        ? `error; no more retries left`
        : `error; not retryable`;
      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
      const errText = await response
        .text()
        .catch((err2) => castToError(err2).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? void 0 : errText;
      loggerFor(this).debug(
        `[${requestLogID}] response error (${retryMessage})`,
        formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          message: errMessage,
          durationMs: Date.now() - startTime,
        }),
      );
      const err = this.makeStatusError(
        response.status,
        errJSON,
        errMessage,
        response.headers,
      );
      throw err;
    }
    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(
      `[${requestLogID}] response start`,
      formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        durationMs: headersTime - startTime,
      }),
    );
    return {
      response,
      options,
      controller,
      requestLogID,
      retryOfRequestLogID,
      startTime,
    };
  }
  getAPIList(path2, Page2, opts) {
    return this.requestAPIList(
      Page2,
      opts && "then" in opts
        ? opts.then((opts2) => ({ method: "get", path: path2, ...opts2 }))
        : { method: "get", path: path2, ...opts },
    );
  }
  requestAPIList(Page2, options) {
    const request = this.makeRequest(options, null, void 0);
    return new PagePromise(this, request, Page2);
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, method, ...options } = init || {};
    const abort = this._makeAbort(controller);
    if (signal) signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, ms);
    const isReadableBody =
      (globalThis.ReadableStream &&
        options.body instanceof globalThis.ReadableStream) ||
      (typeof options.body === "object" &&
        options.body !== null &&
        Symbol.asyncIterator in options.body);
    const fetchOptions = {
      signal: controller.signal,
      ...(isReadableBody ? { duplex: "half" } : {}),
      method: "GET",
      ...options,
    };
    if (method) {
      fetchOptions.method = method.toUpperCase();
    }
    try {
      return await this.fetch.call(void 0, url, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }
  }
  async shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true") return true;
    if (shouldRetryHeader === "false") return false;
    if (response.status === 408) return true;
    if (response.status === 409) return true;
    if (response.status === 429) return true;
    if (response.status >= 500) return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders?.get("retry-after-ms");
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders?.get("retry-after");
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1e3;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (timeoutMillis === void 0) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(
        retriesRemaining,
        maxRetries,
      );
    }
    await sleep(timeoutMillis);
    return this.makeRequest(options, retriesRemaining - 1, requestLogID);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(
      initialRetryDelay * Math.pow(2, numRetries),
      maxRetryDelay,
    );
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1e3;
  }
  calculateNonstreamingTimeout(maxTokens, maxNonstreamingTokens) {
    const maxTime = 60 * 60 * 1e3;
    const defaultTime = 60 * 10 * 1e3;
    const expectedTime = (maxTime * maxTokens) / 128e3;
    if (
      expectedTime > defaultTime ||
      (maxNonstreamingTokens != null && maxTokens > maxNonstreamingTokens)
    ) {
      throw new AnthropicError(
        "Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details",
      );
    }
    return defaultTime;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    const options = { ...inputOptions };
    const { method, path: path2, query, defaultBaseURL } = options;
    const url = this.buildURL(path2, query, defaultBaseURL);
    if ("timeout" in options)
      validatePositiveInteger("timeout", options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    const { bodyHeaders, body } = this.buildBody({ options });
    const reqHeaders = await this.buildHeaders({
      options: inputOptions,
      method,
      bodyHeaders,
      retryCount,
    });
    const req = {
      method,
      headers: reqHeaders,
      ...(options.signal && { signal: options.signal }),
      ...(globalThis.ReadableStream &&
        body instanceof globalThis.ReadableStream && { duplex: "half" }),
      ...(body && { body }),
      ...(this.fetchOptions ?? {}),
      ...(options.fetchOptions ?? {}),
    };
    return { req, url, timeout: options.timeout };
  }
  async buildHeaders({ options, method, bodyHeaders, retryCount }) {
    let idempotencyHeaders = {};
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: "application/json",
        "User-Agent": this.getUserAgent(),
        "X-Stainless-Retry-Count": String(retryCount),
        ...(options.timeout
          ? { "X-Stainless-Timeout": String(Math.trunc(options.timeout / 1e3)) }
          : {}),
        ...getPlatformHeaders(),
        ...(this._options.dangerouslyAllowBrowser
          ? { "anthropic-dangerous-direct-browser-access": "true" }
          : void 0),
        "anthropic-version": "2023-06-01",
      },
      await this.authHeaders(options),
      this._options.defaultHeaders,
      bodyHeaders,
      options.headers,
    ]);
    this.validateHeaders(headers);
    return headers.values;
  }
  _makeAbort(controller) {
    return () => controller.abort();
  }
  buildBody({ options: { body, headers: rawHeaders } }) {
    if (!body) {
      return { bodyHeaders: void 0, body: void 0 };
    }
    const headers = buildHeaders([rawHeaders]);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) ||
      body instanceof ArrayBuffer ||
      body instanceof DataView ||
      (typeof body === "string" && // Preserve legacy string encoding behavior for now
        headers.values.has("content-type")) || // `Blob` is superset of `File`
      (globalThis.Blob && body instanceof globalThis.Blob) || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      (globalThis.ReadableStream && body instanceof globalThis.ReadableStream)
    ) {
      return { bodyHeaders: void 0, body };
    } else if (
      typeof body === "object" &&
      (Symbol.asyncIterator in body ||
        (Symbol.iterator in body &&
          "next" in body &&
          typeof body.next === "function"))
    ) {
      return { bodyHeaders: void 0, body: ReadableStreamFrom(body) };
    } else if (
      typeof body === "object" &&
      headers.values.get("content-type") === "application/x-www-form-urlencoded"
    ) {
      return {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(body),
      };
    } else {
      return __classPrivateFieldGet(this, _BaseAnthropic_encoder, "f").call(
        this,
        { body, headers },
      );
    }
  }
}
((_a = BaseAnthropic),
  (_BaseAnthropic_encoder = /* @__PURE__ */ new WeakMap()),
  (_BaseAnthropic_instances = /* @__PURE__ */ new WeakSet()),
  (_BaseAnthropic_baseURLOverridden =
    function _BaseAnthropic_baseURLOverridden2() {
      return this.baseURL !== "https://api.anthropic.com";
    }));
BaseAnthropic.Anthropic = _a;
BaseAnthropic.HUMAN_PROMPT = HUMAN_PROMPT;
BaseAnthropic.AI_PROMPT = AI_PROMPT;
BaseAnthropic.DEFAULT_TIMEOUT = 6e5;
BaseAnthropic.AnthropicError = AnthropicError;
BaseAnthropic.APIError = APIError;
BaseAnthropic.APIConnectionError = APIConnectionError;
BaseAnthropic.APIConnectionTimeoutError = APIConnectionTimeoutError;
BaseAnthropic.APIUserAbortError = APIUserAbortError;
BaseAnthropic.NotFoundError = NotFoundError;
BaseAnthropic.ConflictError = ConflictError;
BaseAnthropic.RateLimitError = RateLimitError;
BaseAnthropic.BadRequestError = BadRequestError;
BaseAnthropic.AuthenticationError = AuthenticationError;
BaseAnthropic.InternalServerError = InternalServerError;
BaseAnthropic.PermissionDeniedError = PermissionDeniedError;
BaseAnthropic.UnprocessableEntityError = UnprocessableEntityError;
BaseAnthropic.toFile = toFile;
class Anthropic extends BaseAnthropic {
  constructor() {
    super(...arguments);
    this.completions = new Completions(this);
    this.messages = new Messages2(this);
    this.models = new Models2(this);
    this.beta = new Beta(this);
  }
}
Anthropic.Completions = Completions;
Anthropic.Messages = Messages2;
Anthropic.Models = Models2;
Anthropic.Beta = Beta;
if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.data?.type === "builder.fusion.chatRunning") {
      window.dispatchEvent(
        new CustomEvent("builder.fusion.chatRunning", {
          detail: event.data.detail,
        }),
      );
    }
  });
}
function cn(...inputs) {
  return twMerge(clsx(inputs));
}
if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.data?.type === "builder.harnessOrigin" && event.data.origin) {
      event.data.origin;
    }
  });
}
function ErrorBoundary({ error }) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack;
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    error instanceof Error
  ) {
    details = error.message;
    stack = error.stack;
  }
  return jsx("main", {
    className: "flex items-center justify-center min-h-screen p-4",
    children: jsxs("div", {
      className: "text-center",
      children: [
        jsx("h1", { className: "text-4xl font-bold mb-2", children: message }),
        jsx("p", { className: "text-muted-foreground", children: details }),
        stack &&
          jsx("pre", {
            className:
              "mt-4 text-left text-xs overflow-auto max-w-lg mx-auto p-4 bg-muted rounded",
            children: jsx("code", { children: stack }),
          }),
      ],
    }),
  });
}
var main = { exports: {} };
const version = "17.3.1";
const require$$4 = {
  version,
};
var hasRequiredMain;
function requireMain() {
  if (hasRequiredMain) return main.exports;
  hasRequiredMain = 1;
  const fs$1 = fs;
  const path2 = sysPath;
  const os = require$$1;
  const crypto = require$$0;
  const packageJson = require$$4;
  const version2 = packageJson.version;
  const TIPS = [
    "🔐 encrypt with Dotenvx: https://dotenvx.com",
    "🔐 prevent committing .env to code: https://dotenvx.com/precommit",
    "🔐 prevent building .env in docker: https://dotenvx.com/prebuild",
    "🤖 agentic secret storage: https://dotenvx.com/as2",
    "⚡️ secrets for agents: https://dotenvx.com/as2",
    "🛡️ auth for agents: https://vestauth.com",
    "🛠️  run anywhere with `dotenvx run -- yourcommand`",
    "⚙️  specify custom .env file path with { path: '/custom/path/.env' }",
    "⚙️  enable debug logging with { debug: true }",
    "⚙️  override existing env vars with { override: true }",
    "⚙️  suppress all logs with { quiet: true }",
    "⚙️  write to custom object with { processEnv: myObject }",
    "⚙️  load multiple .env files with { path: ['.env.local', '.env'] }",
  ];
  function _getRandomTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }
  function parseBoolean(value) {
    if (typeof value === "string") {
      return !["false", "0", "no", "off", ""].includes(value.toLowerCase());
    }
    return Boolean(value);
  }
  function supportsAnsi() {
    return process.stdout.isTTY;
  }
  function dim(text) {
    return supportsAnsi() ? `\x1B[2m${text}\x1B[0m` : text;
  }
  const LINE =
    /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
  function parse(src) {
    const obj = {};
    let lines = src.toString();
    lines = lines.replace(/\r\n?/gm, "\n");
    let match;
    while ((match = LINE.exec(lines)) != null) {
      const key = match[1];
      let value = match[2] || "";
      value = value.trim();
      const maybeQuote = value[0];
      value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
      if (maybeQuote === '"') {
        value = value.replace(/\\n/g, "\n");
        value = value.replace(/\\r/g, "\r");
      }
      obj[key] = value;
    }
    return obj;
  }
  function _parseVault(options) {
    options = options || {};
    const vaultPath = _vaultPath(options);
    options.path = vaultPath;
    const result = DotenvModule.configDotenv(options);
    if (!result.parsed) {
      const err = new Error(
        `MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`,
      );
      err.code = "MISSING_DATA";
      throw err;
    }
    const keys = _dotenvKey(options).split(",");
    const length = keys.length;
    let decrypted;
    for (let i = 0; i < length; i++) {
      try {
        const key = keys[i].trim();
        const attrs = _instructions(result, key);
        decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
        break;
      } catch (error) {
        if (i + 1 >= length) {
          throw error;
        }
      }
    }
    return DotenvModule.parse(decrypted);
  }
  function _warn(message) {
    console.error(`[dotenv@${version2}][WARN] ${message}`);
  }
  function _debug(message) {
    console.log(`[dotenv@${version2}][DEBUG] ${message}`);
  }
  function _log(message) {
    console.log(`[dotenv@${version2}] ${message}`);
  }
  function _dotenvKey(options) {
    if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
      return options.DOTENV_KEY;
    }
    if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
      return process.env.DOTENV_KEY;
    }
    return "";
  }
  function _instructions(result, dotenvKey) {
    let uri;
    try {
      uri = new URL(dotenvKey);
    } catch (error) {
      if (error.code === "ERR_INVALID_URL") {
        const err = new Error(
          "INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development",
        );
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      throw error;
    }
    const key = uri.password;
    if (!key) {
      const err = new Error("INVALID_DOTENV_KEY: Missing key part");
      err.code = "INVALID_DOTENV_KEY";
      throw err;
    }
    const environment = uri.searchParams.get("environment");
    if (!environment) {
      const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
      err.code = "INVALID_DOTENV_KEY";
      throw err;
    }
    const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
    const ciphertext = result.parsed[environmentKey];
    if (!ciphertext) {
      const err = new Error(
        `NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`,
      );
      err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
      throw err;
    }
    return { ciphertext, key };
  }
  function _vaultPath(options) {
    let possibleVaultPath = null;
    if (options && options.path && options.path.length > 0) {
      if (Array.isArray(options.path)) {
        for (const filepath of options.path) {
          if (fs$1.existsSync(filepath)) {
            possibleVaultPath = filepath.endsWith(".vault")
              ? filepath
              : `${filepath}.vault`;
          }
        }
      } else {
        possibleVaultPath = options.path.endsWith(".vault")
          ? options.path
          : `${options.path}.vault`;
      }
    } else {
      possibleVaultPath = path2.resolve(process.cwd(), ".env.vault");
    }
    if (fs$1.existsSync(possibleVaultPath)) {
      return possibleVaultPath;
    }
    return null;
  }
  function _resolveHome(envPath) {
    return envPath[0] === "~"
      ? path2.join(os.homedir(), envPath.slice(1))
      : envPath;
  }
  function _configVault(options) {
    const debug = parseBoolean(
      process.env.DOTENV_CONFIG_DEBUG || (options && options.debug),
    );
    const quiet = parseBoolean(
      process.env.DOTENV_CONFIG_QUIET || (options && options.quiet),
    );
    if (debug || !quiet) {
      _log("Loading env from encrypted .env.vault");
    }
    const parsed = DotenvModule._parseVault(options);
    let processEnv = process.env;
    if (options && options.processEnv != null) {
      processEnv = options.processEnv;
    }
    DotenvModule.populate(processEnv, parsed, options);
    return { parsed };
  }
  function configDotenv(options) {
    const dotenvPath = path2.resolve(process.cwd(), ".env");
    let encoding = "utf8";
    let processEnv = process.env;
    if (options && options.processEnv != null) {
      processEnv = options.processEnv;
    }
    let debug = parseBoolean(
      processEnv.DOTENV_CONFIG_DEBUG || (options && options.debug),
    );
    let quiet = parseBoolean(
      processEnv.DOTENV_CONFIG_QUIET || (options && options.quiet),
    );
    if (options && options.encoding) {
      encoding = options.encoding;
    } else {
      if (debug) {
        _debug("No encoding is specified. UTF-8 is used by default");
      }
    }
    let optionPaths = [dotenvPath];
    if (options && options.path) {
      if (!Array.isArray(options.path)) {
        optionPaths = [_resolveHome(options.path)];
      } else {
        optionPaths = [];
        for (const filepath of options.path) {
          optionPaths.push(_resolveHome(filepath));
        }
      }
    }
    let lastError;
    const parsedAll = {};
    for (const path3 of optionPaths) {
      try {
        const parsed = DotenvModule.parse(
          fs$1.readFileSync(path3, { encoding }),
        );
        DotenvModule.populate(parsedAll, parsed, options);
      } catch (e) {
        if (debug) {
          _debug(`Failed to load ${path3} ${e.message}`);
        }
        lastError = e;
      }
    }
    const populated = DotenvModule.populate(processEnv, parsedAll, options);
    debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || debug);
    quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || quiet);
    if (debug || !quiet) {
      const keysCount = Object.keys(populated).length;
      const shortPaths = [];
      for (const filePath of optionPaths) {
        try {
          const relative = path2.relative(process.cwd(), filePath);
          shortPaths.push(relative);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${filePath} ${e.message}`);
          }
          lastError = e;
        }
      }
      _log(
        `injecting env (${keysCount}) from ${shortPaths.join(",")} ${dim(`-- tip: ${_getRandomTip()}`)}`,
      );
    }
    if (lastError) {
      return { parsed: parsedAll, error: lastError };
    } else {
      return { parsed: parsedAll };
    }
  }
  function config(options) {
    if (_dotenvKey(options).length === 0) {
      return DotenvModule.configDotenv(options);
    }
    const vaultPath = _vaultPath(options);
    if (!vaultPath) {
      _warn(
        `You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`,
      );
      return DotenvModule.configDotenv(options);
    }
    return DotenvModule._configVault(options);
  }
  function decrypt(encrypted, keyStr) {
    const key = Buffer.from(keyStr.slice(-64), "hex");
    let ciphertext = Buffer.from(encrypted, "base64");
    const nonce = ciphertext.subarray(0, 12);
    const authTag = ciphertext.subarray(-16);
    ciphertext = ciphertext.subarray(12, -16);
    try {
      const aesgcm = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      aesgcm.setAuthTag(authTag);
      return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
    } catch (error) {
      const isRange = error instanceof RangeError;
      const invalidKeyLength = error.message === "Invalid key length";
      const decryptionFailed =
        error.message === "Unsupported state or unable to authenticate data";
      if (isRange || invalidKeyLength) {
        const err = new Error(
          "INVALID_DOTENV_KEY: It must be 64 characters long (or more)",
        );
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      } else if (decryptionFailed) {
        const err = new Error(
          "DECRYPTION_FAILED: Please check your DOTENV_KEY",
        );
        err.code = "DECRYPTION_FAILED";
        throw err;
      } else {
        throw error;
      }
    }
  }
  function populate(processEnv, parsed, options = {}) {
    const debug = Boolean(options && options.debug);
    const override = Boolean(options && options.override);
    const populated = {};
    if (typeof parsed !== "object") {
      const err = new Error(
        "OBJECT_REQUIRED: Please check the processEnv argument being passed to populate",
      );
      err.code = "OBJECT_REQUIRED";
      throw err;
    }
    for (const key of Object.keys(parsed)) {
      if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
        if (override === true) {
          processEnv[key] = parsed[key];
          populated[key] = parsed[key];
        }
        if (debug) {
          if (override === true) {
            _debug(`"${key}" is already defined and WAS overwritten`);
          } else {
            _debug(`"${key}" is already defined and was NOT overwritten`);
          }
        }
      } else {
        processEnv[key] = parsed[key];
        populated[key] = parsed[key];
      }
    }
    return populated;
  }
  const DotenvModule = {
    configDotenv,
    _configVault,
    _parseVault,
    config,
    decrypt,
    parse,
    populate,
  };
  main.exports.configDotenv = DotenvModule.configDotenv;
  main.exports._configVault = DotenvModule._configVault;
  main.exports._parseVault = DotenvModule._parseVault;
  main.exports.config = DotenvModule.config;
  main.exports.decrypt = DotenvModule.decrypt;
  main.exports.parse = DotenvModule.parse;
  main.exports.populate = DotenvModule.populate;
  main.exports = DotenvModule;
  return main.exports;
}
requireMain();
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = React.forwardRef(
  ({ className, sideOffset = 4, ...props }, ref) =>
    /* @__PURE__ */ jsx(TooltipPrimitive.Content, {
      ref,
      sideOffset,
      className: cn(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      ),
      ...props,
    }),
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1e6;
let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}
const toastTimeouts = /* @__PURE__ */ new Map();
const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId,
    });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
};
const reducer = (state, action) => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t,
        ),
      };
    case "DISMISS_TOAST": {
      const { toastId } = action;
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast2) => {
          addToRemoveQueue(toast2.id);
        });
      }
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === void 0
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === void 0) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};
const listeners = [];
let memoryState = { toasts: [] };
function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}
function toast({ ...props }) {
  const id = genId();
  const update = (props2) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props2, id },
    });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });
  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });
  return {
    id,
    dismiss,
    update,
  };
}
function useToast() {
  const [state, setState] = React.useState(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);
  return {
    ...state,
    toast,
    dismiss: (toastId) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}
const ToastProvider = ToastPrimitives.Provider;
const ToastViewport = React.forwardRef(({ className, ...props }, ref) =>
  /* @__PURE__ */ jsx(ToastPrimitives.Viewport, {
    ref,
    className: cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className,
    ),
    ...props,
  }),
);
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;
const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
const Toast = React.forwardRef(({ className, variant, ...props }, ref) => {
  return /* @__PURE__ */ jsx(ToastPrimitives.Root, {
    ref,
    className: cn(toastVariants({ variant }), className),
    ...props,
  });
});
Toast.displayName = ToastPrimitives.Root.displayName;
const ToastAction = React.forwardRef(({ className, ...props }, ref) =>
  /* @__PURE__ */ jsx(ToastPrimitives.Action, {
    ref,
    className: cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className,
    ),
    ...props,
  }),
);
ToastAction.displayName = ToastPrimitives.Action.displayName;
const ToastClose = React.forwardRef(({ className, ...props }, ref) =>
  /* @__PURE__ */ jsx(ToastPrimitives.Close, {
    ref,
    className: cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className,
    ),
    "toast-close": "",
    ...props,
    children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" }),
  }),
);
ToastClose.displayName = ToastPrimitives.Close.displayName;
const ToastTitle = React.forwardRef(({ className, ...props }, ref) =>
  /* @__PURE__ */ jsx(ToastPrimitives.Title, {
    ref,
    className: cn("text-sm font-semibold", className),
    ...props,
  }),
);
ToastTitle.displayName = ToastPrimitives.Title.displayName;
const ToastDescription = React.forwardRef(({ className, ...props }, ref) =>
  /* @__PURE__ */ jsx(ToastPrimitives.Description, {
    ref,
    className: cn("text-sm opacity-90", className),
    ...props,
  }),
);
ToastDescription.displayName = ToastPrimitives.Description.displayName;
function Toaster$1() {
  const { toasts } = useToast();
  return /* @__PURE__ */ jsxs(ToastProvider, {
    children: [
      toasts.map(function ({ id, title, description, action, ...props }) {
        return /* @__PURE__ */ jsxs(
          Toast,
          {
            ...props,
            children: [
              /* @__PURE__ */ jsxs("div", {
                className: "grid gap-1",
                children: [
                  title && /* @__PURE__ */ jsx(ToastTitle, { children: title }),
                  description &&
                    /* @__PURE__ */ jsx(ToastDescription, {
                      children: description,
                    }),
                ],
              }),
              action,
              /* @__PURE__ */ jsx(ToastClose, {}),
            ],
          },
          id,
        );
      }),
      /* @__PURE__ */ jsx(ToastViewport, {}),
    ],
  });
}
const Toaster = ({ ...props }) => {
  const { theme = "system" } = useTheme();
  return /* @__PURE__ */ jsx(Toaster$2, {
    theme,
    className: "toaster group",
    toastOptions: {
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-muted-foreground",
        actionButton:
          "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton:
          "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
      },
    },
    ...props,
  });
};
function useFileWatcher() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const eventSource = new EventSource("/api/events");
    eventSource.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["document"] });
    };
    eventSource.onerror = (err) => {
      console.error("[FileWatcher] SSE connection error", err);
    };
    return () => {
      eventSource.close();
    };
  }, [queryClient]);
}
function Layout({ children }) {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    suppressHydrationWarning: true,
    children: [
      /* @__PURE__ */ jsxs("head", {
        children: [
          /* @__PURE__ */ jsx("meta", {
            charSet: "utf-8",
          }),
          /* @__PURE__ */ jsx("meta", {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          }),
          /* @__PURE__ */ jsx(Meta, {}),
          /* @__PURE__ */ jsx(Links, {}),
        ],
      }),
      /* @__PURE__ */ jsxs("body", {
        children: [
          children,
          /* @__PURE__ */ jsx(ScrollRestoration, {}),
          /* @__PURE__ */ jsx(Scripts, {}),
        ],
      }),
    ],
  });
}
function FileWatcherSetup() {
  useFileWatcher();
  return null;
}
const root = UNSAFE_withComponentProps(function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return /* @__PURE__ */ jsx(ThemeProvider, {
    attribute: "class",
    defaultTheme: "dark",
    enableSystem: false,
    children: /* @__PURE__ */ jsxs(QueryClientProvider, {
      client: queryClient,
      children: [
        /* @__PURE__ */ jsx(FileWatcherSetup, {}),
        /* @__PURE__ */ jsxs(TooltipProvider, {
          children: [
            /* @__PURE__ */ jsx(Toaster$1, {}),
            /* @__PURE__ */ jsx(Toaster, {}),
            /* @__PURE__ */ jsx(Outlet, {}),
          ],
        }),
      ],
    }),
  });
});
const route0 = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      ErrorBoundary,
      Layout,
      default: root,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const ScrollArea = React.forwardRef(({ className, children, ...props }, ref) =>
  /* @__PURE__ */ jsxs(ScrollAreaPrimitive.Root, {
    ref,
    className: cn("relative overflow-hidden", className),
    ...props,
    children: [
      /* @__PURE__ */ jsx(ScrollAreaPrimitive.Viewport, {
        className: "h-full w-full rounded-[inherit] [&>div]:!block",
        children,
      }),
      /* @__PURE__ */ jsx(ScrollBar, {}),
      /* @__PURE__ */ jsx(ScrollAreaPrimitive.Corner, {}),
    ],
  }),
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;
const ScrollBar = React.forwardRef(
  ({ className, orientation = "vertical", ...props }, ref) =>
    /* @__PURE__ */ jsx(ScrollAreaPrimitive.ScrollAreaScrollbar, {
      ref,
      orientation,
      className: cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent p-[1px]",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        className,
      ),
      ...props,
      children: /* @__PURE__ */ jsx(ScrollAreaPrimitive.ScrollAreaThumb, {
        className: "relative flex-1 rounded-full bg-border",
      }),
    }),
);
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return /* @__PURE__ */ jsx(Comp, {
      className: cn(buttonVariants({ variant, size, className })),
      ref,
      ...props,
    });
  },
);
Button.displayName = "Button";
function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme();
  return /* @__PURE__ */ jsxs(Tooltip, {
    children: [
      /* @__PURE__ */ jsx(TooltipTrigger, {
        asChild: true,
        children: /* @__PURE__ */ jsx(Button, {
          variant: "ghost",
          size: "icon",
          onClick: () => setTheme(theme === "dark" ? "light" : "dark"),
          className: cn(
            "text-sidebar-muted hover:text-sidebar-foreground",
            className,
          ),
          children:
            theme === "dark"
              ? /* @__PURE__ */ jsx(Sun, { size: 14 })
              : /* @__PURE__ */ jsx(Moon, { size: 14 }),
        }),
      }),
      /* @__PURE__ */ jsx(TooltipContent, { children: "Toggle theme" }),
    ],
  });
}
const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuSubTrigger = React.forwardRef(
  ({ className, inset, children, ...props }, ref) =>
    /* @__PURE__ */ jsxs(DropdownMenuPrimitive.SubTrigger, {
      ref,
      className: cn(
        "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
        inset && "pl-8",
        className,
      ),
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsx(ChevronRight, { className: "ml-auto h-4 w-4" }),
      ],
    }),
);
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;
const DropdownMenuSubContent = React.forwardRef(
  ({ className, ...props }, ref) =>
    /* @__PURE__ */ jsx(DropdownMenuPrimitive.SubContent, {
      ref,
      className: cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      ),
      ...props,
    }),
);
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;
const DropdownMenuContent = React.forwardRef(
  ({ className, sideOffset = 4, ...props }, ref) =>
    /* @__PURE__ */ jsx(DropdownMenuPrimitive.Portal, {
      children: /* @__PURE__ */ jsx(DropdownMenuPrimitive.Content, {
        ref,
        sideOffset,
        className: cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        ),
        ...props,
      }),
    }),
);
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;
const DropdownMenuItem = React.forwardRef(
  ({ className, inset, ...props }, ref) =>
    /* @__PURE__ */ jsx(DropdownMenuPrimitive.Item, {
      ref,
      className: cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      ),
      ...props,
    }),
);
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;
const DropdownMenuCheckboxItem = React.forwardRef(
  ({ className, children, checked, ...props }, ref) =>
    /* @__PURE__ */ jsxs(DropdownMenuPrimitive.CheckboxItem, {
      ref,
      className: cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      ),
      checked,
      ...props,
      children: [
        /* @__PURE__ */ jsx("span", {
          className:
            "absolute left-2 flex h-3.5 w-3.5 items-center justify-center",
          children: /* @__PURE__ */ jsx(DropdownMenuPrimitive.ItemIndicator, {
            children: /* @__PURE__ */ jsx(Check, { className: "h-4 w-4" }),
          }),
        }),
        children,
      ],
    }),
);
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;
const DropdownMenuRadioItem = React.forwardRef(
  ({ className, children, ...props }, ref) =>
    /* @__PURE__ */ jsxs(DropdownMenuPrimitive.RadioItem, {
      ref,
      className: cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      ),
      ...props,
      children: [
        /* @__PURE__ */ jsx("span", {
          className:
            "absolute left-2 flex h-3.5 w-3.5 items-center justify-center",
          children: /* @__PURE__ */ jsx(DropdownMenuPrimitive.ItemIndicator, {
            children: /* @__PURE__ */ jsx(Circle, {
              className: "h-2 w-2 fill-current",
            }),
          }),
        }),
        children,
      ],
    }),
);
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;
const DropdownMenuLabel = React.forwardRef(
  ({ className, inset, ...props }, ref) =>
    /* @__PURE__ */ jsx(DropdownMenuPrimitive.Label, {
      ref,
      className: cn(
        "px-2 py-1.5 text-sm font-semibold",
        inset && "pl-8",
        className,
      ),
      ...props,
    }),
);
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;
const DropdownMenuSeparator = React.forwardRef(({ className, ...props }, ref) =>
  /* @__PURE__ */ jsx(DropdownMenuPrimitive.Separator, {
    ref,
    className: cn("-mx-1 my-1 h-px bg-muted", className),
    ...props,
  }),
);
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;
function DocumentTreeItem({
  node,
  depth,
  activeId,
  onSelect,
  onCreateChild,
  onDelete,
  onToggleFavorite,
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isActive = node.id === activeId;
  return /* @__PURE__ */ jsxs("div", {
    children: [
      /* @__PURE__ */ jsxs("div", {
        className: cn(
          "group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-sm min-h-[30px]",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        ),
        style: { paddingLeft: `${depth * 16 + 8}px` },
        onClick: () => onSelect(node.id),
        children: [
          /* @__PURE__ */ jsx("button", {
            className: cn(
              "flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
              !hasChildren && "invisible",
            ),
            onClick: (e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            },
            children: /* @__PURE__ */ jsx(ChevronRight, {
              size: 14,
              className: cn("transition-transform", expanded && "rotate-90"),
            }),
          }),
          /* @__PURE__ */ jsx("span", {
            className: "flex-shrink-0 w-5 text-center",
            children:
              node.icon ||
              /* @__PURE__ */ jsx(FileText, {
                size: 14,
                className: "text-muted-foreground",
              }),
          }),
          /* @__PURE__ */ jsx("span", {
            className: "flex-1 truncate",
            children: node.title || "Untitled",
          }),
          /* @__PURE__ */ jsxs("div", {
            className:
              "opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0",
            children: [
              /* @__PURE__ */ jsxs(DropdownMenu, {
                children: [
                  /* @__PURE__ */ jsx(DropdownMenuTrigger, {
                    asChild: true,
                    children: /* @__PURE__ */ jsx("button", {
                      className:
                        "w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
                      onClick: (e) => e.stopPropagation(),
                      children: /* @__PURE__ */ jsx(MoreHorizontal, {
                        size: 14,
                      }),
                    }),
                  }),
                  /* @__PURE__ */ jsxs(DropdownMenuContent, {
                    align: "start",
                    className: "w-48",
                    children: [
                      /* @__PURE__ */ jsxs(DropdownMenuItem, {
                        onClick: () => onCreateChild(node.id),
                        children: [
                          /* @__PURE__ */ jsx(Plus, {
                            size: 14,
                            className: "mr-2",
                          }),
                          "Add sub-page",
                        ],
                      }),
                      /* @__PURE__ */ jsxs(DropdownMenuItem, {
                        onClick: () =>
                          onToggleFavorite(node.id, !node.isFavorite),
                        children: [
                          /* @__PURE__ */ jsx(Star, {
                            size: 14,
                            className: cn(
                              "mr-2",
                              node.isFavorite && "fill-current",
                            ),
                          }),
                          node.isFavorite
                            ? "Remove from favorites"
                            : "Add to favorites",
                        ],
                      }),
                      /* @__PURE__ */ jsxs(DropdownMenuItem, {
                        className: "text-destructive",
                        onClick: () => onDelete(node.id),
                        children: [
                          /* @__PURE__ */ jsx(Trash2, {
                            size: 14,
                            className: "mr-2",
                          }),
                          "Delete",
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              /* @__PURE__ */ jsx("button", {
                className:
                  "w-5 h-5 flex items-center justify-center rounded hover:bg-accent",
                onClick: (e) => {
                  e.stopPropagation();
                  onCreateChild(node.id);
                },
                title: "Add sub-page",
                children: /* @__PURE__ */ jsx(Plus, { size: 14 }),
              }),
            ],
          }),
        ],
      }),
      hasChildren &&
        expanded &&
        /* @__PURE__ */ jsx("div", {
          children: node.children.map((child) =>
            /* @__PURE__ */ jsx(
              DocumentTreeItem,
              {
                node: child,
                depth: depth + 1,
                activeId,
                onSelect,
                onCreateChild,
                onDelete,
                onToggleFavorite,
              },
              child.id,
            ),
          ),
        }),
    ],
  });
}
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: () => fetchJson("/api/documents"),
    select: (data) => data.documents,
  });
}
function useDocument(id) {
  return useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchJson(`/api/documents/${id}`),
    enabled: !!id,
  });
}
function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      fetchJson("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
function useUpdateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      fetchJson(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({
        queryKey: ["document", variables.id],
      });
    },
  });
}
function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      fetchJson(`/api/documents/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
function buildDocumentTree(documents) {
  const map = /* @__PURE__ */ new Map();
  const roots = [];
  for (const doc of documents) {
    map.set(doc.id, { ...doc, children: [] });
  }
  for (const doc of documents) {
    const node = map.get(doc.id);
    if (doc.parentId && map.has(doc.parentId)) {
      map.get(doc.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortChildren = (nodes) => {
    nodes.sort((a, b) => a.position - b.position);
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);
  return roots;
}
function DocumentSidebar({ activeDocumentId }) {
  const navigate = useNavigate();
  const { data: documents = [] } = useDocuments();
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const tree = buildDocumentTree(documents);
  const favorites = documents.filter((d) => d.isFavorite);
  const handleCreatePage = useCallback(
    async (parentId) => {
      const doc = await createDocument.mutateAsync({
        parentId: parentId ?? null,
      });
      navigate(`/${doc.id}`);
    },
    [createDocument, navigate],
  );
  const handleDelete = useCallback(
    async (id) => {
      await deleteDocument.mutateAsync(id);
      if (activeDocumentId === id) {
        navigate("/");
      }
    },
    [deleteDocument, activeDocumentId, navigate],
  );
  const handleToggleFavorite = useCallback(
    (id, isFavorite) => {
      updateDocument.mutate({ id, isFavorite });
    },
    [updateDocument],
  );
  const filteredDocuments = searchQuery
    ? documents.filter((d) =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : null;
  return /* @__PURE__ */ jsxs("div", {
    className: "flex flex-col h-full w-60 border-r border-border bg-muted/30",
    children: [
      /* @__PURE__ */ jsxs("div", {
        className:
          "flex items-center justify-between px-3 py-2 border-b border-border",
        children: [
          /* @__PURE__ */ jsx("span", {
            className: "text-sm font-semibold text-foreground",
            children: "Documents",
          }),
          /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-1",
            children: [
              /* @__PURE__ */ jsx("button", {
                className:
                  "w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground",
                onClick: () => setIsSearching(!isSearching),
                title: "Search",
                children: /* @__PURE__ */ jsx(Search, { size: 14 }),
              }),
              /* @__PURE__ */ jsx("button", {
                className:
                  "w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground",
                onClick: () => handleCreatePage(),
                title: "New page",
                children: /* @__PURE__ */ jsx(Plus, { size: 14 }),
              }),
            ],
          }),
        ],
      }),
      isSearching &&
        /* @__PURE__ */ jsx("div", {
          className: "px-3 py-2 border-b border-border",
          children: /* @__PURE__ */ jsx("input", {
            autoFocus: true,
            type: "text",
            placeholder: "Search pages...",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Escape") {
                setIsSearching(false);
                setSearchQuery("");
              }
            },
            className:
              "w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring",
          }),
        }),
      /* @__PURE__ */ jsx(ScrollArea, {
        className: "flex-1",
        children: /* @__PURE__ */ jsx("div", {
          className: "py-2",
          children: filteredDocuments
            ? /* @__PURE__ */ jsxs("div", {
                children: [
                  /* @__PURE__ */ jsx("div", {
                    className:
                      "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                    children: "Results",
                  }),
                  filteredDocuments.length === 0
                    ? /* @__PURE__ */ jsx("div", {
                        className:
                          "px-3 py-4 text-sm text-muted-foreground text-center",
                        children: "No pages found",
                      })
                    : filteredDocuments.map((doc) =>
                        /* @__PURE__ */ jsxs(
                          "button",
                          {
                            className: cn(
                              "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left rounded-md",
                              doc.id === activeDocumentId
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            ),
                            onClick: () => {
                              navigate(`/${doc.id}`);
                              setIsSearching(false);
                              setSearchQuery("");
                            },
                            children: [
                              /* @__PURE__ */ jsx("span", {
                                className: "flex-shrink-0 w-5 text-center",
                                children:
                                  doc.icon ||
                                  /* @__PURE__ */ jsx(FileText, { size: 14 }),
                              }),
                              /* @__PURE__ */ jsx("span", {
                                className: "truncate",
                                children: doc.title || "Untitled",
                              }),
                            ],
                          },
                          doc.id,
                        ),
                      ),
                ],
              })
            : /* @__PURE__ */ jsxs(Fragment, {
                children: [
                  favorites.length > 0 &&
                    /* @__PURE__ */ jsxs("div", {
                      className: "mb-2",
                      children: [
                        /* @__PURE__ */ jsxs("div", {
                          className:
                            "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1",
                          children: [
                            /* @__PURE__ */ jsx(Star, { size: 10 }),
                            "Favorites",
                          ],
                        }),
                        favorites.map((doc) =>
                          /* @__PURE__ */ jsxs(
                            "button",
                            {
                              className: cn(
                                "w-full flex items-center gap-2 px-4 py-1.5 text-sm text-left rounded-md",
                                doc.id === activeDocumentId
                                  ? "bg-accent text-accent-foreground"
                                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                              ),
                              onClick: () => navigate(`/${doc.id}`),
                              children: [
                                /* @__PURE__ */ jsx("span", {
                                  className: "flex-shrink-0 w-5 text-center",
                                  children:
                                    doc.icon ||
                                    /* @__PURE__ */ jsx(FileText, { size: 14 }),
                                }),
                                /* @__PURE__ */ jsx("span", {
                                  className: "truncate",
                                  children: doc.title || "Untitled",
                                }),
                              ],
                            },
                            doc.id,
                          ),
                        ),
                      ],
                    }),
                  /* @__PURE__ */ jsxs("div", {
                    children: [
                      /* @__PURE__ */ jsx("div", {
                        className:
                          "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                        children: "Pages",
                      }),
                      tree.length === 0
                        ? /* @__PURE__ */ jsx("div", {
                            className:
                              "px-3 py-4 text-sm text-muted-foreground text-center",
                            children: "No pages yet",
                          })
                        : tree.map((node) =>
                            /* @__PURE__ */ jsx(
                              DocumentTreeItem,
                              {
                                node,
                                depth: 0,
                                activeId: activeDocumentId,
                                onSelect: (id) => navigate(`/${id}`),
                                onCreateChild: (parentId) =>
                                  handleCreatePage(parentId),
                                onDelete: handleDelete,
                                onToggleFavorite: handleToggleFavorite,
                              },
                              node.id,
                            ),
                          ),
                    ],
                  }),
                ],
              }),
        }),
      }),
      /* @__PURE__ */ jsxs("div", {
        className:
          "flex items-center justify-between px-3 py-2 border-t border-border",
        children: [
          /* @__PURE__ */ jsxs(Button, {
            variant: "ghost",
            size: "sm",
            className: "h-8 px-2 text-xs text-muted-foreground",
            onClick: () => handleCreatePage(),
            children: [
              /* @__PURE__ */ jsx(Plus, { size: 14, className: "mr-1" }),
              "New page",
            ],
          }),
          /* @__PURE__ */ jsx(ThemeToggle, {}),
        ],
      }),
    ],
  });
}
function AppLayout({ activeDocumentId, children }) {
  return /* @__PURE__ */ jsxs("div", {
    className: "flex h-screen overflow-hidden bg-background",
    children: [
      /* @__PURE__ */ jsx(DocumentSidebar, { activeDocumentId }),
      /* @__PURE__ */ jsx("main", {
        className: "flex-1 flex flex-col min-w-0 relative",
        children,
      }),
    ],
  });
}
function EmptyState() {
  const navigate = useNavigate();
  const createDocument = useCreateDocument();
  const handleCreate = async () => {
    const doc = await createDocument.mutateAsync({});
    navigate(`/${doc.id}`);
  };
  return /* @__PURE__ */ jsx("div", {
    className: "flex-1 flex items-center justify-center bg-background",
    children: /* @__PURE__ */ jsxs("div", {
      className: "text-center max-w-md px-6",
      children: [
        /* @__PURE__ */ jsx("div", {
          className:
            "inline-flex items-center justify-center w-14 h-14 rounded-xl bg-muted mb-6",
          children: /* @__PURE__ */ jsx(FileText, {
            size: 24,
            className: "text-muted-foreground",
          }),
        }),
        /* @__PURE__ */ jsx("h2", {
          className: "text-lg font-semibold text-foreground mb-2",
          children: "No page selected",
        }),
        /* @__PURE__ */ jsx("p", {
          className: "text-sm text-muted-foreground leading-relaxed mb-6",
          children:
            "Select a page from the sidebar or create a new one to get started.",
        }),
        /* @__PURE__ */ jsxs(Button, {
          onClick: handleCreate,
          size: "sm",
          children: [
            /* @__PURE__ */ jsx(Plus, { size: 14, className: "mr-1.5" }),
            "New page",
          ],
        }),
      ],
    }),
  });
}
function meta() {
  return [
    {
      title: "Documents",
    },
  ];
}
const HydrateFallback = UNSAFE_withHydrateFallbackProps(
  function HydrateFallback2() {
    return /* @__PURE__ */ jsx("div", {
      className: "flex items-center justify-center h-screen w-full",
      children: /* @__PURE__ */ jsx("div", {
        className:
          "animate-spin rounded-full h-8 w-8 border-b-2 border-foreground",
      }),
    });
  },
);
const _index = UNSAFE_withComponentProps(function IndexRoute() {
  return /* @__PURE__ */ jsx(AppLayout, {
    activeDocumentId: null,
    children: /* @__PURE__ */ jsx(EmptyState, {}),
  });
});
const route1 = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      HydrateFallback,
      default: _index,
      meta,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
function BubbleToolbar({ editor }) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const handleSetLink = () => {
    if (linkUrl.trim()) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl.trim() })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };
  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setShowLinkInput(true);
  };
  const items = [
    {
      icon: Bold,
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
    },
    {
      icon: Italic,
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
    },
    {
      icon: Strikethrough,
      title: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
    },
    {
      icon: Code,
      title: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
    },
    { type: "divider" },
    {
      icon: Heading1,
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      icon: Heading2,
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      icon: Heading3,
      title: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    { type: "divider" },
    {
      icon: Link,
      title: "Link",
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
  ];
  return /* @__PURE__ */ jsx(BubbleMenu, {
    editor,
    className: "bubble-toolbar",
    shouldShow: ({ editor: editor2, state, from, to }) => {
      if (!editor2.isFocused) return false;
      const isSelection = from !== to;
      return isSelection;
    },
    children: showLinkInput
      ? /* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-1 px-1",
          onMouseDown: (e) => e.preventDefault(),
          children: [
            /* @__PURE__ */ jsx("input", {
              autoFocus: true,
              type: "url",
              placeholder: "Paste link...",
              value: linkUrl,
              onChange: (e) => setLinkUrl(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") handleSetLink();
                if (e.key === "Escape") {
                  setShowLinkInput(false);
                  setLinkUrl("");
                }
              },
              className:
                "bg-transparent border-none outline-none text-white text-sm w-48 px-1 py-0.5 placeholder:text-gray-400",
            }),
            /* @__PURE__ */ jsx("button", {
              onClick: handleSetLink,
              className:
                "text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 font-medium",
              children: "Apply",
            }),
          ],
        })
      : /* @__PURE__ */ jsx("div", {
          className: "flex items-center gap-0.5",
          onMouseDown: (e) => e.preventDefault(),
          children: items.map((item, i) => {
            if ("type" in item && item.type === "divider") {
              return /* @__PURE__ */ jsx(
                "div",
                { className: "w-px h-5 bg-gray-600 mx-0.5" },
                `d-${i}`,
              );
            }
            const { icon: Icon, title, action, isActive } = item;
            return /* @__PURE__ */ jsx(
              "button",
              {
                onClick: action,
                title,
                className: cn(
                  "p-1.5 rounded transition-colors",
                  isActive()
                    ? "bg-gray-600 text-white"
                    : "text-gray-300 hover:bg-gray-700 hover:text-white",
                ),
                children: /* @__PURE__ */ jsx(Icon, {
                  size: 14,
                  strokeWidth: 2.5,
                }),
              },
              title,
            );
          }),
        }),
  });
}
const commands = [
  {
    title: "Text",
    description: "Plain text block",
    icon: Type,
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large heading",
    icon: Heading1,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    icon: Heading2,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: Heading3,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: List,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: ListOrdered,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do List",
    description: "Checklist items",
    icon: CheckSquare,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Code Block",
    description: "Code snippet",
    icon: Code2,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: Quote,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: Minus,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: "Table",
    description: "Add a table",
    icon: Table,
    action: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];
function SlashCommandMenu({ editor }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState(null);
  const menuRef = useRef(null);
  const slashPosRef = useRef(null);
  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase()),
  );
  const executeCommand = useCallback(
    (cmd) => {
      if (slashPosRef.current !== null) {
        const { from } = editor.state.selection;
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashPosRef.current, to: from })
          .run();
      }
      cmd.action(editor);
      setIsOpen(false);
      setQuery("");
      slashPosRef.current = null;
    },
    [editor],
  );
  useEffect(() => {
    if (!editor) return;
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setQuery("");
        slashPosRef.current = null;
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, selectedIndex, filteredCommands, executeCommand, editor]);
  useEffect(() => {
    if (!editor) return;
    const handleTransaction = () => {
      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(
        Math.max(0, from - 20),
        from,
        "\n",
      );
      const slashMatch = textBefore.match(/\/([a-zA-Z0-9]*)$/);
      if (slashMatch) {
        const slashStart = from - slashMatch[0].length;
        slashPosRef.current = slashStart;
        setQuery(slashMatch[1]);
        setSelectedIndex(0);
        const coords = editor.view.coordsAtPos(from);
        const editorRect = editor.view.dom
          .closest(".visual-editor-wrapper")
          ?.getBoundingClientRect();
        if (editorRect) {
          setPosition({
            top: coords.bottom - editorRect.top + 4,
            left: coords.left - editorRect.left,
          });
        }
        setIsOpen(true);
      } else {
        if (isOpen) {
          setIsOpen(false);
          setQuery("");
          slashPosRef.current = null;
        }
      }
    };
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, isOpen]);
  if (!isOpen || !position || filteredCommands.length === 0) return null;
  return /* @__PURE__ */ jsx("div", {
    ref: menuRef,
    className: "slash-command-menu",
    style: {
      position: "absolute",
      top: position.top,
      left: Math.min(position.left, 400),
      zIndex: 50,
    },
    children: /* @__PURE__ */ jsxs("div", {
      className: "py-1.5",
      children: [
        /* @__PURE__ */ jsx("div", {
          className:
            "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
          children: "Blocks",
        }),
        filteredCommands.map((cmd) => {
          const globalIndex = filteredCommands.indexOf(cmd);
          return /* @__PURE__ */ jsx(
            CommandButton,
            {
              cmd,
              isSelected: globalIndex === selectedIndex,
              onExecute: () => executeCommand(cmd),
              onHover: () => setSelectedIndex(globalIndex),
            },
            cmd.title,
          );
        }),
      ],
    }),
  });
}
function CommandButton({ cmd, isSelected, onExecute, onHover }) {
  return /* @__PURE__ */ jsxs("button", {
    onClick: onExecute,
    onMouseEnter: onHover,
    className: cn(
      "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
      isSelected ? "bg-accent" : "hover:bg-accent/50",
    ),
    children: [
      /* @__PURE__ */ jsx("div", {
        className:
          "flex items-center justify-center w-9 h-9 rounded-md border border-border bg-background text-muted-foreground",
        children: /* @__PURE__ */ jsx(cmd.icon, { size: 18 }),
      }),
      /* @__PURE__ */ jsxs("div", {
        children: [
          /* @__PURE__ */ jsx("div", {
            className: "text-sm font-medium text-foreground",
            children: cmd.title,
          }),
          /* @__PURE__ */ jsx("div", {
            className: "text-xs text-muted-foreground",
            children: cmd.description,
          }),
        ],
      }),
    ],
  });
}
function LinkHoverPreview({ editor }) {
  const [hoveredLink, setHoveredLink] = useState(null);
  const hoverTimer = useRef();
  const leaveTimer = useRef();
  const previewRef = useRef(null);
  useEffect(() => {
    const handleMouseMove = (e) => {
      const target = e.target;
      const link = target.closest("a.notion-link");
      if (link && editor.view.dom.contains(link)) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = void 0;
        const url = link.href;
        const rect = link.getBoundingClientRect();
        if (hoveredLink?.url === url) return;
        let pos = -1;
        try {
          pos = editor.view.posAtDOM(link, 0);
        } catch {}
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          setHoveredLink({ url, rect, pos });
        }, 300);
      } else {
        const isHoveringPreview = previewRef.current?.contains(target);
        if (!isHoveringPreview) {
          clearTimeout(hoverTimer.current);
          if (hoveredLink && !leaveTimer.current) {
            leaveTimer.current = setTimeout(() => {
              setHoveredLink(null);
              leaveTimer.current = void 0;
            }, 300);
          }
        } else {
          clearTimeout(leaveTimer.current);
          leaveTimer.current = void 0;
        }
      }
    };
    const handleMouseLeave = () => {
      clearTimeout(hoverTimer.current);
      leaveTimer.current = setTimeout(() => {
        setHoveredLink(null);
        leaveTimer.current = void 0;
      }, 300);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      clearTimeout(hoverTimer.current);
      clearTimeout(leaveTimer.current);
    };
  }, [editor, hoveredLink]);
  const handleRemoveLink = () => {
    if (hoveredLink && hoveredLink.pos >= 0) {
      editor
        .chain()
        .setTextSelection(hoveredLink.pos)
        .extendMarkRange("link")
        .unsetLink()
        .run();
      setHoveredLink(null);
    }
  };
  if (!hoveredLink) return null;
  const domain = (() => {
    try {
      return new URL(hoveredLink.url).hostname;
    } catch {
      return hoveredLink.url;
    }
  })();
  return /* @__PURE__ */ jsx("div", {
    ref: previewRef,
    onMouseLeave: () => {
      leaveTimer.current = setTimeout(() => {
        setHoveredLink(null);
        leaveTimer.current = void 0;
      }, 300);
    },
    onMouseEnter: () => {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = void 0;
    },
    style: {
      position: "fixed",
      top: hoveredLink.rect.bottom + 8,
      left: Math.max(16, hoveredLink.rect.left),
      zIndex: 50,
    },
    className:
      "w-72 rounded-lg border bg-popover text-popover-foreground shadow-md overflow-hidden animate-in fade-in-0 zoom-in-95",
    children: /* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 p-2",
      children: [
        /* @__PURE__ */ jsx("a", {
          href: hoveredLink.url,
          target: "_blank",
          rel: "noopener noreferrer",
          className: "flex-1 text-xs text-blue-500 hover:underline truncate",
          children: domain,
        }),
        /* @__PURE__ */ jsx("a", {
          href: hoveredLink.url,
          target: "_blank",
          rel: "noopener noreferrer",
          className:
            "text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent",
          title: "Open link",
          children: /* @__PURE__ */ jsx(ExternalLink, {
            className: "h-3.5 w-3.5",
          }),
        }),
        /* @__PURE__ */ jsx("button", {
          onClick: handleRemoveLink,
          className:
            "text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10",
          title: "Remove link",
          children: /* @__PURE__ */ jsx(Unlink, { className: "h-3.5 w-3.5" }),
        }),
      ],
    }),
  });
}
function TableHoverControls({ editor }) {
  const [hoveredCell, setHoveredCell] = useState(null);
  const [table, setTable] = useState(null);
  const [cellRect, setCellRect] = useState(null);
  const [tableRect, setTableRect] = useState(null);
  const hideTimeout = useRef(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const handleMouseMove = (e) => {
      const target = e.target;
      let cell = target.closest("td, th");
      let tableEl = target.closest("table");
      const isControl = target.closest(".table-hover-controls");
      if (!cell || !tableEl) {
        const tables = Array.from(editor.view.dom.querySelectorAll("table"));
        for (const t of tables) {
          const rect = t.getBoundingClientRect();
          if (
            e.clientX >= rect.left - 24 &&
            e.clientX <= rect.right + 24 &&
            e.clientY >= rect.top - 24 &&
            e.clientY <= rect.bottom + 24
          ) {
            const rows = Array.from(t.querySelectorAll("tr"));
            let closestRow = rows[0];
            let minDistanceY = Infinity;
            for (const r of rows) {
              const rRect = r.getBoundingClientRect();
              const distY = Math.max(
                0,
                rRect.top - e.clientY,
                e.clientY - rRect.bottom,
              );
              if (distY < minDistanceY) {
                minDistanceY = distY;
                closestRow = r;
              }
            }
            if (closestRow) {
              const cells = Array.from(closestRow.querySelectorAll("td, th"));
              let closestCell = cells[0];
              let minDistanceX = Infinity;
              for (const c of cells) {
                const cRect = c.getBoundingClientRect();
                const distX = Math.max(
                  0,
                  cRect.left - e.clientX,
                  e.clientX - cRect.right,
                );
                if (distX < minDistanceX) {
                  minDistanceX = distX;
                  closestCell = c;
                }
              }
              if (closestCell) {
                cell = closestCell;
                tableEl = t;
                break;
              }
            }
          }
        }
      }
      if ((cell && tableEl && editor.view.dom.contains(tableEl)) || isControl) {
        if (hideTimeout.current) {
          clearTimeout(hideTimeout.current);
          hideTimeout.current = null;
        }
        if (cell && tableEl) {
          setHoveredCell(cell);
          setTable(tableEl);
          setCellRect(cell.getBoundingClientRect());
          setTableRect(tableEl.getBoundingClientRect());
        }
      } else {
        if (!hideTimeout.current && hoveredCell) {
          hideTimeout.current = setTimeout(() => {
            setHoveredCell(null);
            setTable(null);
          }, 150);
        }
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [editor, hoveredCell]);
  if (!hoveredCell || !table || !cellRect || !tableRect) return null;
  const wrapper = editor.view.dom.closest(".visual-editor-wrapper");
  const wrapperRect = wrapper?.getBoundingClientRect();
  if (!wrapperRect) return null;
  const handleAction = (action) => {
    if (!hoveredCell) return;
    try {
      const pos = editor.view.posAtDOM(hoveredCell, 0);
      if (pos < 0) return;
      editor.chain().focus().setTextSelection(pos).run();
      switch (action) {
        case "addCol":
          editor.chain().focus().addColumnAfter().run();
          break;
        case "delCol": {
          const currentTable = hoveredCell.closest("table");
          const colsCount =
            currentTable?.querySelector("tr")?.querySelectorAll("td, th")
              .length || 0;
          if (colsCount <= 1) {
            editor.chain().focus().deleteTable().run();
          } else {
            editor.chain().focus().deleteColumn().run();
          }
          break;
        }
        case "addRow":
          editor.chain().focus().addRowAfter().run();
          break;
        case "delRow": {
          const currentTable = hoveredCell.closest("table");
          const rowsCount = currentTable?.querySelectorAll("tr").length || 0;
          if (rowsCount <= 1) {
            editor.chain().focus().deleteTable().run();
          } else {
            editor.chain().focus().deleteRow().run();
          }
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
    setHoveredCell(null);
    setTable(null);
  };
  const colLeft = cellRect.left - wrapperRect.left + cellRect.width / 2;
  const colTop = tableRect.top - wrapperRect.top - 8;
  const rowLeft = tableRect.left - wrapperRect.left - 8;
  const rowTop = cellRect.top - wrapperRect.top + cellRect.height / 2;
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [
      /* @__PURE__ */ jsxs("div", {
        className:
          "table-hover-controls flex items-center gap-0.5 absolute z-50 transform -translate-x-1/2 -translate-y-full bg-background shadow-sm border border-border rounded-md p-0.5 transition-opacity",
        style: { left: colLeft, top: colTop },
        children: [
          /* @__PURE__ */ jsx("button", {
            onClick: () => handleAction("addCol"),
            title: "Add column",
            className:
              "p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors",
            children: /* @__PURE__ */ jsx(Plus, { size: 14, strokeWidth: 2.5 }),
          }),
          /* @__PURE__ */ jsx("button", {
            onClick: () => handleAction("delCol"),
            title: "Delete column",
            className:
              "p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive transition-colors",
            children: /* @__PURE__ */ jsx(Minus, {
              size: 14,
              strokeWidth: 2.5,
            }),
          }),
        ],
      }),
      /* @__PURE__ */ jsxs("div", {
        className:
          "table-hover-controls flex flex-col items-center gap-0.5 absolute z-50 transform -translate-x-full -translate-y-1/2 bg-background shadow-sm border border-border rounded-md p-0.5 transition-opacity",
        style: { left: rowLeft, top: rowTop },
        children: [
          /* @__PURE__ */ jsx("button", {
            onClick: () => handleAction("addRow"),
            title: "Add row",
            className:
              "p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors",
            children: /* @__PURE__ */ jsx(Plus, { size: 14, strokeWidth: 2.5 }),
          }),
          /* @__PURE__ */ jsx("button", {
            onClick: () => handleAction("delRow"),
            title: "Delete row",
            className:
              "p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive transition-colors",
            children: /* @__PURE__ */ jsx(Minus, {
              size: 14,
              strokeWidth: 2.5,
            }),
          }),
        ],
      }),
    ],
  });
}
function ImageBlock({ node, updateAttributes, deleteNode, selected }) {
  const [isHovered, setIsHovered] = useState(false);
  const src = node.attrs.src;
  const alt = node.attrs.alt;
  if (!src) {
    return /* @__PURE__ */ jsx(NodeViewWrapper, {
      className: "media-block-wrapper",
      "data-drag-handle": true,
      children: /* @__PURE__ */ jsx("div", {
        className: "media-placeholder",
        children: /* @__PURE__ */ jsx("span", {
          className: "text-muted-foreground text-sm",
          children: "No image source",
        }),
      }),
    });
  }
  return /* @__PURE__ */ jsx(NodeViewWrapper, {
    className: "media-block-wrapper",
    "data-drag-handle": true,
    children: /* @__PURE__ */ jsxs("div", {
      className: `media-block ${selected ? "media-block--selected" : ""}`,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      children: [
        /* @__PURE__ */ jsx("img", {
          src,
          alt: alt || "",
          className: "media-block__content",
        }),
        (isHovered || selected) &&
          /* @__PURE__ */ jsx("div", {
            className: "media-block__overlay",
            children: /* @__PURE__ */ jsx("button", {
              onClick: deleteNode,
              className: "media-block__btn media-block__btn--danger",
              title: "Remove image",
              children: /* @__PURE__ */ jsx(Trash2, { size: 14 }),
            }),
          }),
      ],
    }),
  });
}
defaultMarkdownSerializer.nodes.image = function (state, node) {
  const src = node.attrs.src || "";
  const alt = node.attrs.alt || "";
  const title = node.attrs.title || "";
  const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  state.write(`![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`);
  state.closeBlock(node);
};
const ImageNode = Image.extend({
  inline: false,
  group: "block",
  atom: true,
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlock);
  },
});
const CustomTable = Table$1.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.inTable = true;
          node.forEach((row, _p, i) => {
            state.write("| ");
            row.forEach((col, _p2, j) => {
              if (j) {
                state.write(" | ");
              }
              col.forEach((child, _offset, index) => {
                if (index > 0) state.write("<br>");
                if (child.type.name === "image") {
                  const src = child.attrs.src || "";
                  const alt = child.attrs.alt || "";
                  const title = child.attrs.title || "";
                  const escapedTitle = title
                    ? ` "${title.replace(/"/g, '\\"')}"`
                    : "";
                  state.write(
                    `![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`,
                  );
                } else if (child.isTextblock) {
                  const oldWrite = state.write;
                  state.write = function (str) {
                    if (str === void 0) {
                      oldWrite.call(this);
                    } else {
                      oldWrite.call(this, str.replace(/\n/g, "<br>"));
                    }
                  };
                  state.renderInline(child);
                  state.write = oldWrite;
                } else {
                  state.write(
                    state.esc(child.textContent || "").replace(/\n/g, " "),
                  );
                }
              });
            });
            state.write(" |");
            state.ensureNewLine();
            if (i === 0) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => "---")
                .join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});
function VisualEditor({ content, onChange, editable = true }) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {
          HTMLAttributes: { class: "notion-code-block" },
        },
        horizontalRule: {},
        dropcursor: { color: "hsl(243 75% 59%)", width: 2 },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level;
            if (level === 1) return "Heading 1";
            if (level === 2) return "Heading 2";
            return "Heading 3";
          }
          return "Type '/' for commands...";
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Link$1.configure({
        openOnClick: false,
        HTMLAttributes: { class: "notion-link" },
      }),
      TaskList.configure({
        HTMLAttributes: { class: "notion-task-list" },
      }),
      TaskItem.configure({
        nested: true,
      }),
      ImageNode.configure({
        HTMLAttributes: { class: "notion-image" },
      }),
      CustomTable.configure({
        resizable: false,
        HTMLAttributes: { class: "notion-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "notion-editor",
      },
    },
    onUpdate: ({ editor: editor2 }) => {
      if (isSettingContent.current) return;
      try {
        const md = editor2.storage.markdown.getMarkdown();
        onChangeRef.current(md);
      } catch (err) {
        toast$1.error("Markdown serialization error: " + err.message);
        console.error("Markdown serialization error:", err);
      }
    },
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = editor.storage.markdown.getMarkdown();
    if (currentMd !== content) {
      if (editor.isFocused) return;
      isSettingContent.current = true;
      editor.commands.setContent(content);
      isSettingContent.current = false;
    }
  }, [content, editor]);
  if (!editor) return null;
  return /* @__PURE__ */ jsxs("div", {
    className: "visual-editor-wrapper",
    children: [
      /* @__PURE__ */ jsx(BubbleToolbar, { editor }),
      /* @__PURE__ */ jsx(SlashCommandMenu, { editor }),
      /* @__PURE__ */ jsx(LinkHoverPreview, { editor }),
      /* @__PURE__ */ jsx(TableHoverControls, { editor }),
      /* @__PURE__ */ jsx(EditorContent, { editor }),
    ],
  });
}
function DocumentEditor({ documentId }) {
  const { data: document2, isLoading } = useDocument(documentId);
  const updateDocument = useUpdateDocument();
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef(null);
  const lastSavedRef = useRef({ title: "", content: "" });
  const isInitializedRef = useRef(false);
  useEffect(() => {
    if (document2 && !isInitializedRef.current) {
      setLocalTitle(document2.title);
      setLocalContent(document2.content);
      lastSavedRef.current = {
        title: document2.title,
        content: document2.content,
      };
      isInitializedRef.current = true;
    }
  }, [document2]);
  useEffect(() => {
    isInitializedRef.current = false;
  }, [documentId]);
  const debouncedSave = useCallback(
    (title, content) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        const updates = {};
        if (title !== lastSavedRef.current.title) updates.title = title;
        if (content !== lastSavedRef.current.content) updates.content = content;
        if (Object.keys(updates).length === 0) return;
        setIsSaving(true);
        try {
          await updateDocument.mutateAsync({ id: documentId, ...updates });
          lastSavedRef.current = { title, content };
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [documentId, updateDocument],
  );
  const handleTitleChange = useCallback(
    (newTitle) => {
      setLocalTitle(newTitle);
      debouncedSave(newTitle, localContent);
    },
    [debouncedSave, localContent],
  );
  const handleContentChange = useCallback(
    (newContent) => {
      setLocalContent(newContent);
      debouncedSave(localTitle, newContent);
    },
    [debouncedSave, localTitle],
  );
  if (isLoading) {
    return /* @__PURE__ */ jsx("div", {
      className: "flex items-center justify-center h-full",
      children: /* @__PURE__ */ jsx(Loader2, {
        className: "w-6 h-6 animate-spin text-muted-foreground",
      }),
    });
  }
  if (!document2) {
    return /* @__PURE__ */ jsx("div", {
      className:
        "flex items-center justify-center h-full text-muted-foreground",
      children: "Document not found",
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "flex-1 flex flex-col min-h-0",
    children: [
      isSaving &&
        /* @__PURE__ */ jsxs("div", {
          className:
            "absolute top-3 right-4 flex items-center gap-1.5 text-xs text-muted-foreground z-10",
          children: [
            /* @__PURE__ */ jsx(Loader2, {
              size: 12,
              className: "animate-spin",
            }),
            "Saving...",
          ],
        }),
      /* @__PURE__ */ jsxs("div", {
        className: "px-16 pt-16 pb-2",
        children: [
          /* @__PURE__ */ jsx("div", {
            className: "flex items-center gap-3 mb-2",
            children:
              document2.icon &&
              /* @__PURE__ */ jsx("span", {
                className: "text-4xl",
                children: document2.icon,
              }),
          }),
          /* @__PURE__ */ jsx("input", {
            value: localTitle,
            onChange: (e) => handleTitleChange(e.target.value),
            placeholder: "Untitled",
            className:
              "w-full text-4xl font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40",
          }),
        ],
      }),
      /* @__PURE__ */ jsx("div", {
        className: "flex-1 px-16 pb-16 min-h-0 overflow-auto",
        children: /* @__PURE__ */ jsx(VisualEditor, {
          content: localContent,
          onChange: handleContentChange,
          editable: true,
        }),
      }),
    ],
  });
}
const $id = UNSAFE_withComponentProps(function DocumentPage() {
  const { id } = useParams();
  return /* @__PURE__ */ jsx(AppLayout, {
    activeDocumentId: id ?? null,
    children: id
      ? /* @__PURE__ */ jsx(DocumentEditor, {
          documentId: id,
        })
      : /* @__PURE__ */ jsx("div", {
          className:
            "flex-1 flex items-center justify-center text-muted-foreground",
          children: "Document not found",
        }),
  });
});
const route2 = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: $id,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const serverManifest = {
  entry: {
    module: "/assets/entry.client-DshpyR4e.js",
    imports: ["/assets/index-BMHtNQid.js"],
    css: [],
  },
  routes: {
    root: {
      id: "root",
      parentId: void 0,
      path: "",
      index: void 0,
      caseSensitive: void 0,
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasDefaultExport: true,
      hasErrorBoundary: true,
      module: "/assets/root-Dz4tCxG6.js",
      imports: [
        "/assets/index-BMHtNQid.js",
        "/assets/createLucideIcon-rfCLSgWW.js",
        "/assets/index-B1GyCeXj.js",
      ],
      css: ["/assets/root-DR-XlrKt.css"],
      clientActionModule: void 0,
      clientLoaderModule: void 0,
      clientMiddlewareModule: void 0,
      hydrateFallbackModule: void 0,
    },
    "routes/_index": {
      id: "routes/_index",
      parentId: "root",
      path: void 0,
      index: true,
      caseSensitive: void 0,
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasDefaultExport: true,
      hasErrorBoundary: false,
      module: "/assets/_index-DMOUQwCV.js",
      imports: [
        "/assets/index-BMHtNQid.js",
        "/assets/AppLayout-D6MCaqV6.js",
        "/assets/createLucideIcon-rfCLSgWW.js",
      ],
      css: [],
      clientActionModule: void 0,
      clientLoaderModule: void 0,
      clientMiddlewareModule: void 0,
      hydrateFallbackModule: void 0,
    },
    "routes/$id": {
      id: "routes/$id",
      parentId: "root",
      path: ":id",
      index: void 0,
      caseSensitive: void 0,
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasDefaultExport: true,
      hasErrorBoundary: false,
      module: "/assets/_id-DwrOEfyg.js",
      imports: [
        "/assets/index-BMHtNQid.js",
        "/assets/AppLayout-D6MCaqV6.js",
        "/assets/createLucideIcon-rfCLSgWW.js",
        "/assets/index-B1GyCeXj.js",
      ],
      css: [],
      clientActionModule: void 0,
      clientLoaderModule: void 0,
      clientMiddlewareModule: void 0,
      hydrateFallbackModule: void 0,
    },
  },
  url: "/assets/manifest-0a3508c6.js",
  version: "0a3508c6",
  sri: void 0,
};
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = {
  unstable_optimizeDeps: false,
  unstable_subResourceIntegrity: false,
  unstable_trailingSlashAwareDataRequests: false,
  unstable_previewServerPrerendering: false,
  v8_middleware: false,
  v8_splitRouteModules: false,
  v8_viteEnvironmentApi: false,
};
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { mode: "lazy", manifestPath: "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  root: {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0,
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route1,
  },
  "routes/$id": {
    id: "routes/$id",
    parentId: "root",
    path: ":id",
    index: void 0,
    caseSensitive: void 0,
    module: route2,
  },
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr,
};
