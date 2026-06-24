/**
 * Minimal, dependency-free Builder.io API client for the autosave contract
 * test harness. Mirrors the real write path in
 * `templates/content/actions/_builder-cms-write-client.ts`:
 *
 *   - Write API:   https://builder.io/api/v1/write/{model}[/{id}]
 *                  Authorization: Bearer {privateKey}
 *   - Delivery:    https://cdn.builder.io/api/v3/content/{model}[/{id}]?apiKey={publicKey}
 *
 * Hosts are overridable via BUILDER_CONTENT_API_HOST / BUILDER_CMS_API_HOST so
 * the harness can be pointed at a mock or a staging space.
 *
 * Every call returns a CapturedExchange: the exact request (URL with the
 * private key redacted, method, redacted headers, body) and the raw response
 * (status, headers, parsed/raw body). That captured evidence is what the
 * findings doc is built from — not documentation.
 */

import { MutableModel, MutableTarget } from "./safety.ts";

export interface CapturedExchange {
  label: string;
  request: {
    method: string;
    url: string; // private key already redacted
    headers: Record<string, string>; // authorization redacted
    body: unknown;
  };
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
  durationMs: number;
  capturedAt: string;
}

export interface BuilderClientConfig {
  privateKey: string | undefined;
  publicKey: string | undefined;
  writeHost: string;
  cdnHost: string;
}

/**
 * Matches any field/param NAME that may carry a credential. Case-insensitive,
 * substring match so e.g. `privateKey`, `BUILDER_API_KEY`, `x-api-key`,
 * `accessToken`, `authorization` are all caught. This is the single rule both
 * URL-query redaction and body redaction use.
 */
const SENSITIVE_NAME_PATTERN =
  /(api[-_ ]?key|^key$|[-_]key$|^token$|[-_]?token$|secret|password|passwd|private[-_ ]?key|bearer|authorization|auth$|credential)/i;

const REDACTED = "<REDACTED>";

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_PATTERN.test(name);
}

/**
 * Redact credential-looking query params anywhere in a URL (including nested
 * URLs embedded as query values, e.g. Builder pixel/preview `previewUrl`s that
 * carry an `apiKey`). Recurses into embedded URL strings.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveName(key)) {
        url.searchParams.set(key, REDACTED);
      } else {
        // A param value may itself be (or contain) a URL with a nested apiKey.
        const value = url.searchParams.get(key);
        if (value && looksLikeUrl(value)) {
          url.searchParams.set(key, redactUrl(value));
        }
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function looksLikeUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    value.includes("apiKey=") ||
    value.includes("api_key=")
  );
}

/**
 * Recursively redact a value before it is persisted as evidence. Strips:
 *  - object fields whose KEY looks like a credential (replaced with <REDACTED>),
 *  - any string VALUE that is/contains a URL with a credential query param.
 * This is the SINGLE path all persisted evidence flows through (request bodies,
 * response bodies, and any string that might smuggle an apiKey in a URL).
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeUrl(value) ? redactUrl(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveName(key) ? REDACTED : redactDeep(v);
    }
    return out;
  }
  return value;
}

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") {
      out[key] = "Bearer <REDACTED>";
    } else if (isSensitiveName(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function responseHeadersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function parseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function resolveConfig(): BuilderClientConfig {
  const writeHost = (
    process.env.BUILDER_CONTENT_API_HOST ??
    process.env.BUILDER_CMS_API_HOST ??
    "https://builder.io"
  ).replace(/\/+$/, "");
  const cdnHost = (
    process.env.BUILDER_CDN_HOST ?? "https://cdn.builder.io"
  ).replace(/\/+$/, "");
  return {
    privateKey:
      process.env.BUILDER_PRIVATE_KEY ?? process.env.BUILDER_CMS_PRIVATE_KEY,
    publicKey: process.env.BUILDER_API_KEY ?? process.env.BUILDER_PUBLIC_KEY,
    writeHost,
    cdnHost,
  };
}

export class BuilderContractClient {
  private readonly config: BuilderClientConfig;
  readonly exchanges: CapturedExchange[] = [];

  constructor(config: BuilderClientConfig) {
    this.config = config;
  }

  hasWriteCredentials(): boolean {
    return Boolean(this.config.privateKey);
  }

  hasReadCredentials(): boolean {
    return Boolean(this.config.publicKey);
  }

  // `#`-private (not TS `private`): the raw HTTP helpers are unreachable from
  // outside the class even via an `any` cast, so the only externally-callable
  // write surface is the token-gated createEntry/patchEntry.
  async #capture(args: {
    label: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<CapturedExchange> {
    const startedAt = Date.now();
    const init: RequestInit = {
      method: args.method,
      headers: args.headers,
    };
    if (args.body !== undefined) {
      init.body = JSON.stringify(args.body);
    }
    const response = await fetch(args.url, init);
    const text = await response.text();
    // Every persisted field flows through redactDeep — the single redaction
    // chokepoint — so a credential cannot reach evidence via a body field or a
    // URL smuggled inside a response (e.g. previewUrl/pixel apiKey).
    const exchange: CapturedExchange = {
      label: args.label,
      request: {
        method: args.method,
        url: redactUrl(args.url),
        headers: redactHeaders(args.headers),
        body: redactDeep(args.body ?? null),
      },
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: redactHeaders(responseHeadersToObject(response.headers)),
        body: redactDeep(parseBody(text)),
      },
      durationMs: Date.now() - startedAt,
      capturedAt: new Date(startedAt).toISOString(),
    };
    this.exchanges.push(exchange);
    return exchange;
  }

  // ---- Write API (requires private key) ----

  #writeHeaders(): Record<string, string> {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.config.privateKey ?? ""}`,
      "content-type": "application/json",
    };
  }

  /**
   * POST /api/v1/write/{model} — create a new entry.
   *
   * Requires a `MutableModel` capability token, which can only be obtained from
   * `assertModelAllowedForLive` in safety.ts. A bare model string is NOT
   * accepted, so a create into a production model is impossible without the
   * model passing the live gate first.
   */
  async createEntry(args: {
    label: string;
    target: MutableModel;
    body: Record<string, unknown>;
  }): Promise<CapturedExchange> {
    if (!MutableModel.is(args.target)) {
      throw new Error(
        "SAFETY ABORT: createEntry requires a MutableModel token from " +
          "assertModelAllowedForLive — refusing to write from a bare model id.",
      );
    }
    const model = args.target.model;
    const url = `${this.config.writeHost}/api/v1/write/${encodeURIComponent(model)}`;
    return this.#capture({
      label: args.label,
      method: "POST",
      url,
      headers: this.#writeHeaders(),
      body: args.body,
    });
  }

  /**
   * PATCH /api/v1/write/{model}/{id} — update an existing entry.
   *
   * `query` lets the caller toggle autoSaveOnly / triggerWebhooks exactly as
   * the production adapter does. Returns the captured exchange.
   */
  async patchEntry(args: {
    label: string;
    target: MutableTarget;
    query?: Record<string, string>;
    body: Record<string, unknown>;
  }): Promise<CapturedExchange> {
    if (!MutableTarget.is(args.target)) {
      throw new Error(
        "SAFETY ABORT: patchEntry requires a MutableTarget token from the " +
          "ThrowawayRegistry — refusing to mutate from a bare entry id.",
      );
    }
    const { model, entryId } = args.target;
    const url = new URL(
      `${this.config.writeHost}/api/v1/write/${encodeURIComponent(model)}/${encodeURIComponent(entryId)}`,
    );
    for (const [k, v] of Object.entries(args.query ?? {})) {
      url.searchParams.set(k, v);
    }
    return this.#capture({
      label: args.label,
      method: "PATCH",
      url: url.toString(),
      headers: this.#writeHeaders(),
      body: args.body,
    });
  }

  // ---- Delivery / read API (requires public key) ----

  /**
   * GET https://cdn.builder.io/api/v3/content/{model}/{id}
   *
   * Without includeUnpublished this returns the LIVE delivered artifact (what
   * a site visitor sees). With includeUnpublished=true it also returns drafts.
   * cachebust defeats the delivery cache so we read current state.
   */
  async getDeliveredEntry(args: {
    label: string;
    model: string;
    entryId: string;
    includeUnpublished?: boolean;
    cachebust?: boolean;
  }): Promise<CapturedExchange> {
    const url = new URL(
      `${this.config.cdnHost}/api/v3/content/${encodeURIComponent(args.model)}/${encodeURIComponent(args.entryId)}`,
    );
    url.searchParams.set("apiKey", this.config.publicKey ?? "");
    if (args.includeUnpublished)
      url.searchParams.set("includeUnpublished", "true");
    if (args.cachebust) url.searchParams.set("cachebust", String(Date.now()));
    return this.#capture({
      label: args.label,
      method: "GET",
      url: url.toString(),
      headers: { accept: "application/json" },
    });
  }

  /**
   * GET https://cdn.builder.io/api/v3/content/{model}?query.id={id}
   * Used to characterize duplicate-handle resolution and listing semantics.
   */
  async queryEntries(args: {
    label: string;
    model: string;
    query?: Record<string, string>;
    includeUnpublished?: boolean;
    limit?: number;
  }): Promise<CapturedExchange> {
    const url = new URL(
      `${this.config.cdnHost}/api/v3/content/${encodeURIComponent(args.model)}`,
    );
    url.searchParams.set("apiKey", this.config.publicKey ?? "");
    if (args.includeUnpublished)
      url.searchParams.set("includeUnpublished", "true");
    if (typeof args.limit === "number")
      url.searchParams.set("limit", String(args.limit));
    url.searchParams.set("cachebust", String(Date.now()));
    for (const [k, v] of Object.entries(args.query ?? {})) {
      url.searchParams.set(k, v);
    }
    return this.#capture({
      label: args.label,
      method: "GET",
      url: url.toString(),
      headers: { accept: "application/json" },
    });
  }
}
