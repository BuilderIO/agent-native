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

import { fail, isActionContractError } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { ResolvedKeyReference } from "../secrets/substitution.js";
import { SAVE_TO_FILE_MAX_BYTES } from "../workspace-files/constants.js";
import {
  collectSecretValues,
  MAX_EXTENSION_PROXY_RESPONSE_SIZE,
  normalizeExtensionProxyMethod,
  readResponseBytesWithLimit,
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
  hasWebContentSearch,
  parseWebContentSearchOptions,
  processWebContent,
} from "./web-content.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_WEB_REQUEST_HTML_BYTES = SAVE_TO_FILE_MAX_BYTES;
const VISION_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const CREDENTIAL_NAME_RE =
  /(?:^|[-_])(access[-_]?token|api[-_]?key|auth(?:orization)?|credential|expires?|key[-_]?pair[-_]?id|key|password|passwd|policy|secret|session|signature|sig|token|jwt|assertion)(?:$|[-_])/i;

function isHtmlResponseContentType(contentType: string): boolean {
  const mediaType = contentType.toLowerCase();
  return (
    mediaType === "text/html" ||
    mediaType === "application/xhtml+xml" ||
    mediaType.endsWith("+html")
  );
}

function truncateToolText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const marker = "\n...[truncated]";
  if (maxChars <= marker.length) return marker.slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length)}${marker}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function hasCredentialBearingImageRequest(
  url: string,
  headers: Record<string, string>,
): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return true;
  }
  if (parsedUrl.username || parsedUrl.password) return true;
  if (parsedUrl.hash) return true;
  if (
    Object.keys(headers).some((name) =>
      CREDENTIAL_NAME_RE.test(name.replace(/([a-z])([A-Z])/g, "$1-$2")),
    )
  ) {
    return true;
  }
  return [...parsedUrl.searchParams.keys()].some((name) =>
    CREDENTIAL_NAME_RE.test(name.replace(/([a-z])([A-Z])/g, "$1-$2")),
  );
}

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
  resolveKeys?: (text: string) => Promise<{
    resolved: string;
    usedKeys: string[];
    secretValues?: string[];
    resolvedKeys?: ResolvedKeyReference[];
  }>;
  validateUrl?: (
    url: string,
    usedKeys: string[],
    resolvedKeys?: ResolvedKeyReference[],
  ) => Promise<boolean>;
}

export function createFetchToolEntry(
  opts: FetchToolOptions = {},
): Record<string, ActionEntry> {
  return {
    "web-request": {
      tool: {
        description: `Make an outbound HTTP request to an external URL: APIs, webhooks, or web pages. HTML/XHTML responses up to 20 MB are extracted before maxChars limits the response body; optional metadata and links can add characters. Raw and other inline responses remain capped at 1 MB. saveToFile can stage responses up to 20 MB. For HTML, it saves extracted Markdown or text unless responseMode is raw; with search, it returns bounded matches instead of a preview. Sends realistic Chrome-on-macOS headers by default; explicit headers override them. Supports \${keys.NAME} placeholders in url, headers, and body, resolved server-side so raw secrets never enter context. Never use this for internal /_agent-native/ endpoints or localhost action URLs; call registered actions directly.`,
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
                "Maximum response-body characters returned to context. Default: 32000; max: 200000. Metadata and optional links are additional. This limits extracted content, not the HTML download. Use saveToFile for a longer extracted document.",
            },
            responseMode: {
              type: "string",
              description:
                "How to return the response. Default: auto (HTML pages become clean markdown; JSON/text stays raw; successful public image responses are attached as vision context). Use raw for exact bytes, markdown/text for extracted readable content, links for just links, metadata for page metadata, or matches with search.",
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
                "Whether extracted HTML responses should include a compact links list. Default: true for inline responses and false when saveToFile is set.",
            },
            search: {
              type: "object",
              description:
                "Optional post-fetch search over extracted content by default. Searches at most the first 500,000 characters of the selected source; saved results report searchSourceTruncated when this limit is reached. Supports {query, queries, terms, regex, regexFlags, source:'extracted'|'raw', maxMatches, contextChars, caseSensitive}. Regex is safety-checked and bounded; prefer query/terms for simple grep-like searches.",
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
                "Workspace path to stage a response up to 20 MB (e.g. 'scratch/research/page.md'). HTML saves full extracted Markdown/text unless responseMode is raw; non-HTML and raw mode save the response body. With search, returns matches bounded by maxChars and reports when source scanning was capped; without search, returns a preview.",
            },
          },
          required: ["url"],
        },
      },
      planMode: {
        effect: (args) => {
          const method = String(args.method ?? "GET").toUpperCase();
          if (method !== "GET" && method !== "HEAD") return "write";
          return args.saveToFile == null ? "read" : "write";
        },
        allowedValues: { method: ["GET", "HEAD"] },
        omittedProperties: ["saveToFile"],
        description:
          "Plan mode allows GET and HEAD requests that return their response without saving it.",
      },
      run: async (args: Record<string, unknown>) => {
        const startTime = Date.now();
        const rawUrl = String(args.url ?? "");
        const method = normalizeExtensionProxyMethod(args.method || "GET");
        if (!method) {
          fail(
            "Unsupported HTTP method. Allowed methods: GET, POST, PUT, PATCH, DELETE, HEAD.",
            { errorCode: "web_request_invalid_method" },
          );
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
            fail(`Error resolving key references: ${err?.message ?? err}`, {
              errorCode: "web_request_key_resolution_failed",
            });
          }
        }
        const secretValues = collectSecretValues(allSecretValues);
        const resolvedKeys = allResolvedKeys.length
          ? allResolvedKeys
          : undefined;

        if (await isBlockedExtensionUrlWithDns(resolvedUrl)) {
          fail(
            `Requests to private/internal addresses are not allowed: "${rawUrl}".`,
            { errorCode: "web_request_url_blocked" },
          );
        }

        if (opts.validateUrl && allUsedKeys.length > 0) {
          try {
            const allowed = await opts.validateUrl(
              resolvedUrl,
              allUsedKeys,
              resolvedKeys,
            );
            if (!allowed) {
              fail(
                `URL "${rawUrl}" is not in the allowlist for the referenced keys. Check your key settings.`,
                { errorCode: "web_request_url_blocked" },
              );
            }
          } catch (err: any) {
            if (isActionContractError(err)) throw err;
            fail(`URL validation error: ${err?.message ?? err}`, {
              errorCode: "web_request_url_validation_failed",
            });
          }
        }

        let headers: Record<string, string>;
        try {
          headers = sanitizeOutboundHeaders(JSON.parse(resolvedHeaders));
        } catch {
          fail(`Invalid headers JSON: ${rawHeaders}`, {
            errorCode: "web_request_invalid_headers",
          });
        }
        headers = applyBrowserDefaults(headers);

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
              fail("Redirect to private/internal address blocked.", {
                errorCode: "web_request_url_blocked",
              });
            }
            if (redirectUrl && opts.validateUrl && allUsedKeys.length > 0) {
              const allowed = await opts.validateUrl(
                redirectUrl,
                allUsedKeys,
                resolvedKeys,
              );
              if (!allowed) {
                fail(
                  "Redirect URL is not in the allowlist for the referenced keys.",
                  { errorCode: "web_request_url_blocked" },
                );
              }
            }
            fail(
              `HTTP ${response.status} ${response.statusText}\n\nRedirect: ${
                redirectUrl ? redactString(redirectUrl, secretValues) : "(none)"
              }`,
              { errorCode: `http_${response.status}` },
            );
          }

          const contentType =
            response.headers.get("content-type")?.split(";")[0].trim() ??
            "text/plain";
          const requestedResponseMode = String(args.responseMode ?? "auto");
          const normalizedResponseMode = requestedResponseMode.toLowerCase();
          const isHtmlContentType = isHtmlResponseContentType(contentType);
          const httpErrorCode = response.ok
            ? undefined
            : `http_${response.status}`;

          const saveToFilePath =
            typeof (args as Record<string, unknown>).saveToFile === "string"
              ? ((args as Record<string, unknown>).saveToFile as string).trim()
              : "";
          const hasCredentials =
            allUsedKeys.length > 0 ||
            hasCredentialBearingImageRequest(resolvedUrl, headers);
          if (
            !saveToFilePath &&
            method === "GET" &&
            response.ok &&
            VISION_IMAGE_CONTENT_TYPES.has(contentType.toLowerCase()) &&
            resolvedUrl.startsWith("https://") &&
            !hasCredentials
          ) {
            const imageBody = await readResponseBytesWithLimit(
              response,
              MAX_EXTENSION_PROXY_RESPONSE_SIZE,
            );
            if (imageBody.truncated) {
              return `HTTP ${response.status} ${response.statusText}\n\nContent-Type: ${contentType}\n\nImage response too large to attach (${imageBody.size} bytes, max ${MAX_EXTENSION_PROXY_RESPONSE_SIZE}).`;
            }
            console.log(
              "[fetch-tool] " +
                method +
                " image → " +
                response.status +
                " (" +
                elapsed +
                "ms, vision image)",
            );
            return {
              status: response.status,
              statusText: response.statusText,
              contentType,
              url: resolvedUrl,
              _agentImages: [
                {
                  data: uint8ArrayToBase64(imageBody.bytes),
                  mediaType: contentType.toLowerCase(),
                },
              ],
            };
          }

          let body: string;
          let bodyResult: {
            text: string;
            truncated: boolean;
            size: number;
          };
          const readLimit =
            saveToFilePath ||
            (isHtmlContentType && normalizedResponseMode !== "raw")
              ? MAX_WEB_REQUEST_HTML_BYTES
              : MAX_EXTENSION_PROXY_RESPONSE_SIZE;
          try {
            bodyResult = await readResponseTextWithLimit(response, readLimit);
          } catch {
            fail("(could not read response body)", {
              errorCode: httpErrorCode ?? "web_request_body_unreadable",
            });
          }
          if (bodyResult.truncated) {
            const declaredBytes = Number(
              response.headers.get("content-length"),
            );
            const exceedsSaveLimit =
              readLimit === MAX_WEB_REQUEST_HTML_BYTES ||
              (Number.isFinite(declaredBytes) &&
                declaredBytes > MAX_WEB_REQUEST_HTML_BYTES);
            const recovery = exceedsSaveLimit
              ? `The response exceeds web-request's ${MAX_WEB_REQUEST_HTML_BYTES}-byte limit.`
              : `Retry with saveToFile to stage responses up to ${MAX_WEB_REQUEST_HTML_BYTES} bytes.`;
            fail(
              `HTTP ${response.status} ${response.statusText}\n\nResponse too large: at least ${bodyResult.size} bytes observed; maximum ${readLimit} bytes. ${recovery}`,
              {
                errorCode: "web_request_response_too_large",
              },
            );
          }
          body = bodyResult.text;
          body = redactString(body, secretValues);
          if (response.ok) {
            const { providerApiResponseOutcomeForUrl } =
              await import("../provider-api/index.js");
            const outcome = providerApiResponseOutcomeForUrl(
              resolvedUrl,
              response,
              body,
            );
            if (!outcome.ok)
              fail(
                `HTTP ${response.status} ${outcome.statusText}\n\n${body.slice(0, maxChars)}`,
                { errorCode: "web_request_provider_failed" },
              );
          }
          let displayBody: string;
          let processedMode = "raw";
          let searchResultsTruncated = false;
          let searchSourceTruncated = false;
          let fileContent = body;
          let fileContentType = contentType;
          const search = parseWebContentSearchOptions(args.search);
          const hasSearch = hasWebContentSearch(search);
          const includeLinks =
            args.includeLinks === undefined
              ? !saveToFilePath
              : parseBooleanArg(args.includeLinks);
          const saveContentFormat =
            saveToFilePath &&
            isHtmlContentType &&
            normalizedResponseMode !== "raw"
              ? normalizedResponseMode === "text"
                ? "text"
                : "markdown"
              : undefined;
          try {
            const processed = await processWebContent({
              url: resolvedUrl,
              body,
              contentType,
              responseMode:
                saveToFilePath && hasSearch ? "matches" : requestedResponseMode,
              extract: String(args.extract ?? "readability"),
              includeLinks,
              search,
              maxChars: saveContentFormat ? null : maxChars,
              saveContentFormat,
            });
            processedMode = processed.mode;
            searchSourceTruncated = processed.searchTruncated ?? false;
            displayBody = formatWebContentResult(processed);

            if (saveToFilePath && hasSearch && displayBody.length > maxChars) {
              searchResultsTruncated = true;
              displayBody = truncateToolText(displayBody, maxChars);
            }

            if (saveContentFormat) {
              if (processed.fullContent === undefined) {
                throw new Error(
                  "HTML extraction did not produce saved content",
                );
              }
              fileContent = formatWebContentResult({
                ...processed,
                mode: saveContentFormat,
                content: processed.fullContent,
                fullContent: undefined,
                matches: undefined,
                totalMatches: undefined,
                omittedMatches: undefined,
                searchSource: undefined,
                searchTruncated: undefined,
                truncated: false,
              });
              fileContentType =
                saveContentFormat === "markdown"
                  ? "text/markdown"
                  : "text/plain";
            }

            if (
              !saveToFilePath &&
              isHtmlContentType &&
              normalizedResponseMode !== "raw" &&
              processed.truncated &&
              processed.contentLength !== undefined
            ) {
              displayBody += `\n\nFull extracted content: ${processed.contentLength} characters. Retry with saveToFile (up to ${MAX_WEB_REQUEST_HTML_BYTES} bytes), then use workspace-files grep or read with offsets.`;
            }
          } catch (err: any) {
            fail(
              `web-request post-processing error: ${err?.message ?? String(err)}`,
              { errorCode: httpErrorCode ?? "web_request_processing_failed" },
            );
          }

          console.log(
            `[fetch-tool] ${method} ${rawUrl} → ${response.status} (${elapsed}ms, keys: ${allUsedKeys.join(",") || "none"})`,
          );

          if (saveToFilePath) {
            try {
              const {
                writeWorkspaceFile,
                isScratchWorkspacePath,
                toWorkspaceFileCard,
              } = await import("../workspace-files/store.js");
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
              const scratchPath = isScratchWorkspacePath(saveToFilePath);
              if (!response.ok && !scratchPath) {
                throw new Error(
                  `Refusing to save a failed response to durable workspace file "${saveToFilePath}" (status ${response.status}). Use a scratch/... path for diagnostics.`,
                );
              }
              const savedFormat = saveContentFormat ?? "raw";
              const meta = await writeWorkspaceFile(
                scope,
                saveToFilePath,
                fileContent,
                fileContentType,
                {
                  maxFileBytes: SAVE_TO_FILE_MAX_BYTES,
                },
              );
              const bytes = Buffer.byteLength(fileContent, "utf8");
              const previewSource = saveContentFormat
                ? fileContent
                : displayBody;
              const preview = previewSource.slice(0, 2000);
              if (!response.ok)
                fail(
                  `HTTP ${response.status} ${response.statusText}\n\n${truncateToolText(displayBody, maxChars)}`,
                  { errorCode: `http_${response.status}` },
                );
              return JSON.stringify({
                savedToFile: true,
                savedTo: saveToFilePath,
                status: response.status,
                bytes,
                chars: fileContent.length,
                contentType,
                savedFormat,
                responseMode: processedMode,
                ...(hasSearch
                  ? {
                      searchResults: displayBody,
                      searchResultsTruncated,
                      searchSourceTruncated,
                    }
                  : {
                      preview:
                        preview.length < previewSource.length
                          ? `${preview}…`
                          : preview,
                    }),
                ...(scratchPath ? {} : { file: toWorkspaceFileCard(meta) }),
              });
            } catch (saveErr: any) {
              if (isActionContractError(saveErr)) throw saveErr;
              fail(
                `saveToFile error: ${saveErr?.message ?? String(saveErr)}\n\nHTTP ${response.status} ${response.statusText}\n\n${body.slice(0, maxChars)}`,
                {
                  errorCode: httpErrorCode ?? "web_request_save_failed",
                },
              );
            }
          }

          if (!response.ok)
            fail(
              `HTTP ${response.status} ${response.statusText}\n\n${displayBody}`,
              { errorCode: `http_${response.status}` },
            );
          return `HTTP ${response.status} ${response.statusText}\n\n${displayBody}`;
        } catch (err: any) {
          if (isActionContractError(err)) throw err;
          const elapsed = Date.now() - startTime;
          if (err?.name === "AbortError") {
            console.log(
              `[fetch-tool] ${method} ${rawUrl} → TIMEOUT (${elapsed}ms)`,
            );
            fail(`Request timed out after ${timeoutMs}ms.`, {
              errorCode: "web_request_timeout",
            });
          }
          const message = redactSecrets(
            err?.message ?? String(err),
            secretValues,
          );
          console.log(
            `[fetch-tool] ${method} ${rawUrl} → ERROR: ${message} (${elapsed}ms)`,
          );
          fail(`Request failed: ${message}`, {
            errorCode: "web_request_failed",
          });
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
