import type { ActionRunContext } from "@agent-native/core/action";
import { createProviderApiRequestAction } from "@agent-native/core/provider-api/actions/provider-api";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { requiresEmailSendApproval } from "../server/lib/automation-settings.js";
import {
  MAIL_APP_ID,
  MAIL_PROVIDER_API_IDS,
  executeProviderApiRequest,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(MAIL_PROVIDER_API_IDS);
const MethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const PaginationSchema = z
  .object({
    nextCursorPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the response JSON where the next cursor/token lives, e.g. 'nextPageToken'.",
      ),
    cursorParam: z
      .string()
      .optional()
      .describe(
        "Query parameter name to inject the cursor into the next request. Use cursorBodyPath for APIs that page through POST bodies.",
      ),
    cursorBodyPath: z
      .string()
      .optional()
      .describe(
        "Dot-path in the JSON request body to set to the next cursor. Use this for POST-body pagination.",
      ),
    pageParam: z
      .string()
      .optional()
      .describe(
        "Use page-number mode: this query param is incremented on each page.",
      ),
    startPage: z.coerce
      .number()
      .int()
      .optional()
      .describe("Starting page number for pageParam mode (default 1)."),
    offsetParam: z
      .string()
      .optional()
      .describe(
        "Use offset mode: this query param is incremented by pageSize on each request.",
      ),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Expected page size for offset increments. Defaults to the actual item count of the first page.",
      ),
    maxPages: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum pages to fetch server-side (default 50, max 200)."),
  })
  .optional();

// What an automation may do without approval. Every other non-GET Gmail call
// stays gated, so an endpoint missing from these lists (permanent delete,
// settings that forward or auto-reply, message insert or import, delegates,
// sendAs, label or filter management) can never bypass approval:
// - reversible label moves, always;
// - sending and composing a send, only when the owner enabled automation sends.
const GMAIL_LABEL_WRITE =
  /^users\/[^/]+\/(?:messages\/(?:batchModify|[^/]+\/(?:modify|trash|untrash))|threads\/[^/]+\/(?:modify|trash|untrash))$/;
const GMAIL_SEND_WRITE = /^users\/[^/]+\/(?:(?:messages|drafts)\/send|drafts)$/;
const GMAIL_DRAFT_UPDATE = /^users\/[^/]+\/drafts\/[^/]+$/;

// The request URL parser turns `\` into `/` and resolves `..`, and the executor
// sends encoded slashes literally. A segment is therefore matched only after it
// is split and decoded on its own, and only if it is plain id characters, so
// `%2f`, `%5c`, a backslash, or a dot segment can never reshape the path the
// patterns above see.
const GMAIL_SAFE_SEGMENT = /^[A-Za-z0-9_.@+-]+$/;

type GmailRequestShape = {
  /** Segments after the `gmail/v1` prefix, decoded and checked. */
  segments: string[];
  /** The media-upload host rather than the REST host. */
  upload: boolean;
};

// An absolute URL counts only in the one form the executor reads as absolute
// (`http(s)://`), on a Gmail API host with no port or credentials; any other
// scheme-like prefix is not matched. Null means the request cannot be tied to a
// Gmail endpoint. A malformed encoding or URL throws, and callers treat a
// throwing gate as approval required.
function gmailRequestShape(path: string): GmailRequestShape | null {
  let pathname: string;
  let upload = false;
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    if (url.hostname === "gmail.googleapis.com") {
      pathname = url.pathname;
    } else if (
      url.hostname === "www.googleapis.com" &&
      url.pathname.startsWith("/upload/gmail/v1/")
    ) {
      pathname = url.pathname.slice("/upload".length);
      upload = true;
    } else {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return null;
  } else {
    [pathname = ""] = path.split(/[?#]/, 1);
  }
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        !GMAIL_SAFE_SEGMENT.test(segment),
    )
  ) {
    return null;
  }
  if (segments[0] === "gmail" && segments[1] === "v1") segments.splice(0, 2);
  return { segments, upload };
}

function isReversibleGmailLabelWrite(
  method: string,
  request: GmailRequestShape | null,
): boolean {
  return (
    method === "POST" &&
    request !== null &&
    !request.upload &&
    GMAIL_LABEL_WRITE.test(request.segments.join("/"))
  );
}

function isGmailSendWrite(
  method: string,
  request: GmailRequestShape | null,
): boolean {
  if (request === null) return false;
  const path = request.segments.join("/");
  return (
    (method === "POST" && GMAIL_SEND_WRITE.test(path)) ||
    (method === "PUT" && !request.upload && GMAIL_DRAFT_UPDATE.test(path))
  );
}

export default createProviderApiRequestAction(
  { executeRequest: executeProviderApiRequest },
  {
    description:
      "Make an arbitrary authenticated HTTP request to a Mail-connected provider API. " +
      "Use this as the flexible escape hatch when a convenience action cannot express the needed Gmail endpoint, search query, filter setting, thread/message format, Google Calendar endpoint, CRM object, pagination mode, payload, or API version. " +
      "The request is constrained to the provider host, uses configured credentials automatically, blocks private/internal URLs, and redacts secrets from responses. " +
      "Unattended automations may send (when the owner allows it), draft, and move labels through this tool; every other non-GET Gmail write needs approval they cannot give. " +
      "Provider calls share a provider/key-aware quota governor with in-flight dedupe, Retry-After handling, and cooldown queuing, so prefer this general path over one-off throttling logic. " +
      "\n\nSTAGING MODE (preferred for large responses): Pass stageAs to write response items into a scratch dataset instead of returning the raw body. " +
      "Returns { dataset, rowCount, columns, sampleRows } so only a compact summary enters context. Use query-staged-dataset to aggregate, filter, and project the data without re-fetching. " +
      "\n\nPAGINATION: When stageAs is set, pass pagination config to fetch all pages server-side into the same dataset. For Gmail list endpoints and Google Calendar events.list, use nextCursorPath='nextPageToken', cursorParam='pageToken', and itemsPath='messages', 'threads', or 'items'.",
    schema: z.object({
      provider: ProviderSchema.describe(
        "Configured provider API to call, e.g. gmail, google_calendar, or hubspot.",
      ),
      method: MethodSchema.default("GET").describe("HTTP method to use."),
      path: z
        .string()
        .min(1)
        .describe(
          "Provider API path such as /users/me/messages, /users/me/settings/filters, /calendars/primary/events, /crm/v3/objects/contacts/search, or a full URL on an allowed provider host. Use placeholders from provider-api-catalog when provided.",
        ),
      query: z
        .unknown()
        .optional()
        .describe(
          "Optional query params as a JSON object/string. Array values produce repeated query params.",
        ),
      headers: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Optional extra headers. Unsafe hop-by-hop headers are ignored. Auth headers are injected from stored credentials.",
        ),
      body: z
        .unknown()
        .optional()
        .describe(
          "Optional request body. Objects/arrays are JSON encoded; strings are sent as-is.",
        ),
      auth: z
        .enum(["default", "none"])
        .default("default")
        .describe(
          "Use default to inject configured provider auth. Use none only for public provider endpoints that intentionally require no auth.",
        ),
      connectionId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional workspace connection ID to use for provider credentials. When set, credentials must resolve from that connection.",
        ),
      accountId: z
        .string()
        .optional()
        .describe(
          "Optional OAuth account id to use for OAuth-backed providers such as Gmail or Google Calendar.",
        ),
      timeoutMs: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(120_000)
        .optional()
        .describe(
          "Request timeout in milliseconds. Default 30000, max 120000.",
        ),
      maxBytes: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(4 * 1024 * 1024)
        .optional()
        .describe(
          "Maximum response bytes to read. Default 1MB, max 4MB. Ignored when saveToFile is set (allows up to 20MB).",
        ),
      stageAs: z
        .string()
        .min(1)
        .optional()
        .describe(
          "When set, parse the response as an array of records and write them into a staged dataset with this name. Returns a compact summary instead of the raw body. Re-staging the same name replaces the previous dataset.",
        ),
      itemsPath: z
        .string()
        .optional()
        .describe(
          "Dot-path to the items array in the response JSON, e.g. 'messages' for Gmail messages.list, 'threads' for Gmail threads.list, 'items' for Google Calendar events.list, or 'results' for CRM searches. Omit for auto-detection.",
        ),
      pagination: PaginationSchema.describe(
        "Pagination config for server-side fetchAll when stageAs is set. Supports cursor (nextCursorPath + cursorParam or cursorBodyPath), page, and offset modes.",
      ),
      saveToFile: z
        .string()
        .optional()
        .describe(
          "Workspace file path to save the full response body to instead of returning it in context, e.g. 'mail/provider-response.json'. When set, returns only a compact summary and allows up to 20MB response.",
        ),
      fetchAllPages: z
        .object({
          cursorPath: z
            .string()
            .describe(
              "Dot-path in the JSON response body where the next-page cursor lives, e.g. 'nextPageToken'.",
            ),
          cursorParam: z
            .string()
            .optional()
            .describe(
              "Query parameter name to pass the cursor on subsequent pages, e.g. 'pageToken'. Use cursorBodyPath instead for APIs that put cursors in POST bodies.",
            ),
          cursorBodyPath: z
            .string()
            .optional()
            .describe(
              "Dot-path in the JSON request body to set to the next cursor. Use for POST-body pagination.",
            ),
          itemsPath: z
            .string()
            .optional()
            .describe(
              "Dot-path to the items array in each response, e.g. 'messages', 'threads', 'items', or 'results'. When omitted, the whole response body is appended per page.",
            ),
          maxPages: z.coerce
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe(
              "Maximum pages to fetch. Default 10, max 50. Stops early when cursor is empty.",
            ),
        })
        .optional()
        .describe(
          "Enable cursor-based pagination. For Gmail or Google Calendar list endpoints, use { cursorPath: 'nextPageToken', cursorParam: 'pageToken', itemsPath: '<messages|threads|items>' }. For APIs that page through POST bodies, use cursorBodyPath instead of cursorParam.",
        ),
    }),
    appId: MAIL_APP_ID,
    getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
    http: false,
    toolCallable: false,
    // The gate decides per request (method and path). A per-tool "always allow"
    // would otherwise cover Gmail deletes and settings writes too.
    allowPersistentApproval: false,
    needsApproval: (
      args: { provider: string; method?: string; path: string },
      ctx?: ActionRunContext,
    ) => {
      // Only Gmail paths are decoded: a malformed path on another provider
      // would otherwise throw here and be held for approval.
      if (args.provider !== "gmail") return false;
      const method = String(args.method ?? "GET").toUpperCase();
      if (["GET", "HEAD"].includes(method)) return false;
      // Both exemptions are for unattended automations; an interactive caller
      // keeps the approval every non-GET Gmail write already needed.
      if (ctx?.caller === "automation") {
        const request = gmailRequestShape(args.path);
        if (isReversibleGmailLabelWrite(method, request)) return false;
        // The send opt-in covers sending and composing a send, not every
        // write: with it on, a permanent delete or a forwarding setting still
        // needs approval.
        if (!isGmailSendWrite(method, request)) return true;
      }
      return requiresEmailSendApproval(ctx);
    },
  },
);
