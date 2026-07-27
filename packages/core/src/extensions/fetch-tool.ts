/**
 * Fetch tool — outbound HTTP for automations and agent use.
 *
 * NOTE: this is an *agent* tool (LLM function call), not an *extension* (the
 * sandboxed Alpine.js mini-app primitive). It lives in this directory because
 * it shares SSRF-safe URL/proxy helpers with the extension iframe proxy.
 *
 * Supports ${keys.NAME} reference substitution in URL, headers, and body.
 * Values are resolved server-side AFTER the model emits the tool call —
 * the raw secret never enters the model's context.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import type { ResolvedKeyReference } from "../secrets/substitution.js";
import {
  collectSecretValues,
  MAX_EXTENSION_PROXY_RESPONSE_SIZE,
  normalizeExtensionProxyMethod,
  readResponseTextWithLimit,
  redactSecrets,
  redactString,
  sanitizeOutboundHeaders,
} from "./proxy-security.js";
import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "./url-safety.js";
import {
  formatWebContentResult,
  parseWebContentSearchOptions,
  processWebContent,
} from "./web-content.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Headers that mimic a current Chrome on macOS so anti-bot middleware (Cloudflare,
 * PerimeterX, Akamai) treats the request as a real user. We only fill in fields
 * the caller hasn't supplied — explicit headers (e.g. an `Authorization` header
 * for an API call) always win.
 *
 * `Accept-Encoding` deliberately omits `zstd` because Node's undici fetch only
 * decompresses `gzip`, `deflate`, and `br`. Advertising `zstd` would let some
 * servers send bytes we can't decode.
 */
const BROWSER_DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Ch-Ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function applyBrowserDefaults(
  headers: Record<string, string>,
): Record<string, string> {
  const seen = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  const merged = { ...headers };
  for (const [name, value] of Object.entries(BROWSER_DEFAULT_HEADERS)) {
    if (!seen.has(name.toLowerCase())) merged[name] = value;
  }
  return merged;
}

export interface FetchToolOptions {
  /** Resolve ${keys.NAME} references. Injected by the plugin at setup time. */
  resolveKeys?: (text: string) => Promise<{
    resolved: string;
    usedKeys: string[];
    secretValues?: string[];
    /**
     * Optional: which scope (user/org/workspace) each used key actually
     * resolved at. Populated by resolvers like
     * `resolveKeyReferencesWithRequestScopes` so `validateUrl` can look up
     * the allowlist at the scope the value came from rather than assuming
     * user scope. Backwards compatible — callers that omit this (or a
     * resolver that doesn't report it) are unaffected.
     */
    resolvedKeys?: ResolvedKeyReference[];
  }>;
  /** Validate URL against per-key allowlists. */
  validateUrl?: (
    url: string,
    usedKeys: string[],
    /** Accumulated `resolvedKeys` from every `resolveKeys` call this request made, when the resolver reported them. */
    resolvedKeys?: ResolvedKeyReference[],
  ) => Promise<boolean>;
}

/**
 * Create the fetch tool entry for the agent tool registry.
 */
export function createFetchToolEntry(
  opts: FetchToolOptions = {},
): Record<string, ActionEntry> {
  return {
    "web-request": {
      tool: {
        description: `Make an outbound HTTP request to any EXTERNAL URL — APIs, webhooks, and arbitrary web pages (HTML, RSS, JSON, etc.). Use this to fetch the contents of a URL the user pastes in chat. Sends realistic Chrome-on-macOS headers by default (User-Agent, Accept, Sec-Fetch-*) so most sites that block obvious bots will respond normally; pass an explicit header to override any default. Supports \${keys.NAME} placeholders in url, headers, and body — these are resolved server-side from the user's saved keys (the raw value never enters your context). Example: \${keys.SLACK_WEBHOOK} in the url field. IMPORTANT: Never use this to call internal /_agent-native/ endpoints or localhost action URLs — use the registered actions directly (e.g. \`search-records\`, \`provider-api-request\`, \`update-resource\`). Actions are already available as native tools; calling them via HTTP is slower and bypasses validation.`,
        parameters: {
          type: "object" as const,
          properties: {
            url: {
              type: "string",
              description:
                'Full URL. May contain ${keys.NAME} references, e.g. "${keys.SLACK_WEBHOOK}".',
            },
            method: {
              type: "string",
              description: "HTTP method. Default: GET.",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
            },
            headers: {
              type: "string",
              description:
                'JSON object of headers. May contain ${keys.NAME} references. Example: \'{"Authorization": "Bearer ${keys.API_TOKEN}"}\'.',
            },
            body: {
              type: "string",
              description:
                "Request body (for POST/PUT/PATCH). May contain ${keys.NAME} references.",
            },
            timeout_ms: {
              type: "number",
              description: `Timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}. Max: 30000.`,
            },
            maxChars: {
              type: "number",
              description:
                "Maximum response body characters to return. Default: 32000. Max: 200000. Increase when you need to read a large document, API response, or dataset.",
            },
            responseMode: {
              type: "string",
              description:
                "How to return the response. Default: auto (HTML pages become clean markdown; JSON/text stays raw). Use raw for exact bytes, markdown/text for extracted readable content, links for just links, metadata for page metadata, or matches with search.",
              enum: [
                "auto",
                "raw",
                "text",
                "markdown",
                "links",
                "metadata",
                "matches",
              ],
            },
            extract: {
              type: "string",
              description:
                "HTML extraction strategy. Default: readability. Use all-visible for visible body text/markdown, or none to convert the full HTML document.",
              enum: ["readability", "all-visible", "none"],
            },
            includeLinks: {
              type: "boolean",
              description:
                "Whether extracted HTML responses should include a compact links list. Default: true for extracted pages.",
            },
            search: {
              type: "object",
              description:
                "Optional post-fetch search over extracted content by default. Supports {query, queries, terms, regex, regexFlags, source:'extracted'|'raw', maxMatches, contextChars, caseSensitive}. Regex is safety-checked and bounded; prefer query/terms for simple grep-like searches.",
              properties: {
                query: { type: "string" },
                queries: { type: "array", items: { type: "string" } },
                terms: { type: "array", items: { type: "string" } },
                regex: { type: "string" },
                regexFlags: { type: "string" },
                source: { type: "string", enum: ["extracted", "raw"] },
                maxMatches: { type: "number" },
                contextChars: { type: "number" },
                caseSensitive: { type: "boolean" },
              },
            } as any,
            saveToFile: {
              type: "string",
              description:
                "Workspace file path to save the full response body to instead of returning it in context (e.g. 'analysis/page.html'). When set, returns only a compact summary {savedTo, status, bytes, preview}. Useful for large web pages or API responses that would overflow context.",
            },
          },
          required: ["url"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        const startTime = Date.now();
        const rawUrl = String(args.url ?? "");
        const method = normalizeExtensionProxyMethod(args.method || "GET");
        if (!method) {
          return "Unsupported HTTP method. Allowed methods: GET, POST, PUT, PATCH, DELETE, HEAD.";
        }
        const rawHeaders =
          typeof args.headers === "string"
            ? args.headers
            : JSON.stringify(args.headers ?? {});
        const rawBody =
          typeof args.body === "string"
            ? args.body
            : args.body === undefined || args.body === null
              ? undefined
              : JSON.stringify(args.body);
        const timeoutMs = Math.min(
          Number(args.timeout_ms) || DEFAULT_TIMEOUT_MS,
          30_000,
        );
        const requestedMaxChars = Number(args.maxChars);
        const maxChars =
          Number.isFinite(requestedMaxChars) && requestedMaxChars > 0
            ? Math.min(requestedMaxChars, 200_000)
            : 32_000;

        // Resolve key references
        let resolvedUrl = rawUrl;
        let resolvedHeaders = rawHeaders;
        let resolvedBody = rawBody;
        const allUsedKeys: string[] = [];
        const allSecretValues: string[] = [];
        const allResolvedKeys: ResolvedKeyReference[] = [];

        if (opts.resolveKeys) {
          try {
            const urlResult = await opts.resolveKeys(rawUrl);
            resolvedUrl = urlResult.resolved;
            allUsedKeys.push(...urlResult.usedKeys);
            allSecretValues.push(...(urlResult.secretValues ?? []));
            allResolvedKeys.push(...(urlResult.resolvedKeys ?? []));

            const headerResult = await opts.resolveKeys(rawHeaders);
            resolvedHeaders = headerResult.resolved;
            allUsedKeys.push(...headerResult.usedKeys);
            allSecretValues.push(...(headerResult.secretValues ?? []));
            allResolvedKeys.push(...(headerResult.resolvedKeys ?? []));

            if (rawBody) {
              const bodyResult = await opts.resolveKeys(rawBody);
              resolvedBody = bodyResult.resolved;
              allUsedKeys.push(...bodyResult.usedKeys);
              allSecretValues.push(...(bodyResult.secretValues ?? []));
              allResolvedKeys.push(...(bodyResult.resolvedKeys ?? []));
            }
          } catch (err: any) {
            return `Error resolving key references: ${err?.message ?? err}`;
          }
        }
        const secretValues = collectSecretValues(allSecretValues);
        const resolvedKeys = allResolvedKeys.length
          ? allResolvedKeys
          : undefined;

        // Block SSRF targets regardless of key usage
        if (await isBlockedExtensionUrlWithDns(resolvedUrl)) {
          return `Requests to private/internal addresses are not allowed: "${rawUrl}".`;
        }

        // Validate URL against per-key allowlists
        if (opts.validateUrl && allUsedKeys.length > 0) {
          try {
            const allowed = await opts.validateUrl(
              resolvedUrl,
              allUsedKeys,
              resolvedKeys,
            );
            if (!allowed) {
              return `URL "${rawUrl}" is not in the allowlist for the referenced keys. Check your key settings.`;
            }
          } catch (err: any) {
            return `URL validation error: ${err?.message ?? err}`;
          }
        }

        // Parse headers, then merge in browser-like defaults for any header the
        // caller didn't already specify. Real-browser headers (User-Agent,
        // Accept, Sec-Fetch-*) are what gets you past Cloudflare / PerimeterX /
        // generic UA-sniffing middleware on sites the user pastes in chat;
        // explicit caller headers always win so API calls keep their auth
        // headers untouched.
        let headers: Record<string, string>;
        try {
          headers = sanitizeOutboundHeaders(JSON.parse(resolvedHeaders));
        } catch {
          return `Invalid headers JSON: ${rawHeaders}`;
        }
        headers = applyBrowserDefaults(headers);

        // Make the request
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;
          const fetchOpts: RequestInit & { dispatcher?: unknown } = {
            method,
            headers,
            signal: controller.signal,
            redirect: "manual",
          };
          if (dispatcher) fetchOpts.dispatcher = dispatcher;
          if (resolvedBody && ["POST", "PUT", "PATCH"].includes(method)) {
            fetchOpts.body = resolvedBody;
            if (!headers["content-type"] && !headers["Content-Type"]) {
              headers["Content-Type"] = "application/json";
            }
          }

          const response = await fetch(resolvedUrl, fetchOpts);
          const elapsed = Date.now() - startTime;

          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            const redirectUrl = location
              ? new URL(location, resolvedUrl).href
              : null;
            if (
              redirectUrl &&
              (await isBlockedExtensionUrlWithDns(redirectUrl))
            ) {
              return "Redirect to private/internal address blocked.";
            }
            if (redirectUrl && opts.validateUrl && allUsedKeys.length > 0) {
              const allowed = await opts.validateUrl(
                redirectUrl,
                allUsedKeys,
                resolvedKeys,
              );
              if (!allowed) {
                return "Redirect URL is not in the allowlist for the referenced keys.";
              }
            }
            return `HTTP ${response.status} ${response.statusText}\n\nRedirect: ${
              redirectUrl ? redactString(redirectUrl, secretValues) : "(none)"
            }`;
          }

          // Check if caller wants to save to workspace file (before truncation).
          const saveToFilePath =
            typeof (args as Record<string, unknown>).saveToFile === "string"
              ? ((args as Record<string, unknown>).saveToFile as string).trim()
              : "";

          let body: string;
          try {
            // When saving to file allow larger reads (20MB), otherwise cap at proxy limit.
            const readLimit = saveToFilePath
              ? 20 * 1024 * 1024
              : MAX_EXTENSION_PROXY_RESPONSE_SIZE;
            const result = await readResponseTextWithLimit(response, readLimit);
            body = result.text;
          } catch {
            body = "(could not read response body)";
          }
          body = redactString(body, secretValues);
          const contentType =
            response.headers.get("content-type")?.split(";")[0].trim() ??
            "text/plain";
          let displayBody: string;
          let processedMode = "raw";
          try {
            const processed = processWebContent({
              url: resolvedUrl,
              body,
              contentType,
              responseMode: String(args.responseMode ?? "auto"),
              extract: String(args.extract ?? "readability"),
              includeLinks:
                args.includeLinks === undefined
                  ? true
                  : parseBooleanArg(args.includeLinks),
              search: parseWebContentSearchOptions(args.search),
              maxChars,
            });
            processedMode = processed.mode;
            displayBody = formatWebContentResult(processed);
          } catch (err: any) {
            return `web-request post-processing error: ${err?.message ?? String(err)}`;
          }

          // Audit log
          console.log(
            `[fetch-tool] ${method} ${rawUrl} → ${response.status} (${elapsed}ms, keys: ${allUsedKeys.join(",") || "none"})`,
          );

          // saveToFile: write full body to workspace and return compact summary.
          if (saveToFilePath) {
            try {
              const { writeWorkspaceFile, SAVE_TO_FILE_MAX_BYTES } =
                await import("../workspace-files/store.js");
              const { getRequestOrgId, getRequestUserEmail } =
                await import("../server/request-context.js");
              const orgId = getRequestOrgId();
              const email = getRequestUserEmail();
              const scope = orgId
                ? { scope: "org" as const, scopeId: orgId }
                : email
                  ? { scope: "user" as const, scopeId: email }
                  : null;
              if (!scope)
                throw new Error("No authenticated context for saveToFile");
              await writeWorkspaceFile(
                scope,
                saveToFilePath,
                body,
                contentType,
                {
                  maxFileBytes: SAVE_TO_FILE_MAX_BYTES,
                },
              );
              const bytes = Buffer.byteLength(body, "utf8");
              const preview = displayBody.slice(0, 2000);
              return JSON.stringify({
                savedToFile: true,
                savedTo: saveToFilePath,
                status: response.status,
                bytes,
                contentType,
                responseMode: processedMode,
                preview:
                  preview.length < displayBody.length ? `${preview}…` : preview,
              });
            } catch (saveErr: any) {
              return `saveToFile error: ${saveErr?.message ?? String(saveErr)}\n\nHTTP ${response.status} ${response.statusText}\n\n${body.slice(0, maxChars)}`;
            }
          }

          return `HTTP ${response.status} ${response.statusText}\n\n${displayBody}`;
        } catch (err: any) {
          const elapsed = Date.now() - startTime;
          if (err?.name === "AbortError") {
            console.log(
              `[fetch-tool] ${method} ${rawUrl} → TIMEOUT (${elapsed}ms)`,
            );
            return `Request timed out after ${timeoutMs}ms.`;
          }
          const message = redactSecrets(
            err?.message ?? String(err),
            secretValues,
          );
          console.log(
            `[fetch-tool] ${method} ${rawUrl} → ERROR: ${message} (${elapsed}ms)`,
          );
          return `Request failed: ${message}`;
        } finally {
          clearTimeout(timeout);
        }
      },
      readOnly: true,
    },
  };
}

function parseBooleanArg(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}
