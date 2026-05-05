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
import {
  collectSecretValues,
  MAX_EXTENSION_PROXY_RESPONSE_SIZE,
  normalizeExtensionProxyMethod,
  readResponseTextWithLimit,
  redactSecrets,
  redactString,
  sanitizeOutboundHeaders,
} from "./proxy-security.js";
import { isBlockedExtensionUrlWithDns } from "./url-safety.js";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchToolOptions {
  /** Resolve ${keys.NAME} references. Injected by the plugin at setup time. */
  resolveKeys?: (text: string) => Promise<{
    resolved: string;
    usedKeys: string[];
    secretValues?: string[];
  }>;
  /** Validate URL against per-key allowlists. */
  validateUrl?: (url: string, usedKeys: string[]) => Promise<boolean>;
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
        description: `Make an outbound HTTP request to EXTERNAL APIs, webhooks, and services only. Supports \${keys.NAME} placeholders in url, headers, and body — these are resolved server-side from the user's saved keys (the raw value never enters your context). Example: \${keys.SLACK_WEBHOOK} in the url field. IMPORTANT: Never use this to call internal /_agent-native/ endpoints or localhost action URLs — use the registered actions directly (e.g. \`log-meal\`, \`bigquery\`, \`hubspot-deals\`). Actions are already available as native tools; calling them via HTTP is slower and bypasses validation.`,
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
          },
          required: ["url"],
        },
      },
      run: async (args: Record<string, string>) => {
        const startTime = Date.now();
        const rawUrl = args.url;
        const method = normalizeExtensionProxyMethod(args.method || "GET");
        if (!method) {
          return "Unsupported HTTP method. Allowed methods: GET, POST, PUT, PATCH, DELETE, HEAD.";
        }
        const rawHeaders = args.headers || "{}";
        const rawBody = args.body;
        const timeoutMs = Math.min(
          Number(args.timeout_ms) || DEFAULT_TIMEOUT_MS,
          30_000,
        );

        // Resolve key references
        let resolvedUrl = rawUrl;
        let resolvedHeaders = rawHeaders;
        let resolvedBody = rawBody;
        const allUsedKeys: string[] = [];
        const allSecretValues: string[] = [];

        if (opts.resolveKeys) {
          try {
            const urlResult = await opts.resolveKeys(rawUrl);
            resolvedUrl = urlResult.resolved;
            allUsedKeys.push(...urlResult.usedKeys);
            allSecretValues.push(...(urlResult.secretValues ?? []));

            const headerResult = await opts.resolveKeys(rawHeaders);
            resolvedHeaders = headerResult.resolved;
            allUsedKeys.push(...headerResult.usedKeys);
            allSecretValues.push(...(headerResult.secretValues ?? []));

            if (rawBody) {
              const bodyResult = await opts.resolveKeys(rawBody);
              resolvedBody = bodyResult.resolved;
              allUsedKeys.push(...bodyResult.usedKeys);
              allSecretValues.push(...(bodyResult.secretValues ?? []));
            }
          } catch (err: any) {
            return `Error resolving key references: ${err?.message ?? err}`;
          }
        }
        const secretValues = collectSecretValues(allSecretValues);

        // Block SSRF targets regardless of key usage
        if (await isBlockedExtensionUrlWithDns(resolvedUrl)) {
          return `Requests to private/internal addresses are not allowed: "${rawUrl}".`;
        }

        // Validate URL against per-key allowlists
        if (opts.validateUrl && allUsedKeys.length > 0) {
          try {
            const allowed = await opts.validateUrl(resolvedUrl, allUsedKeys);
            if (!allowed) {
              return `URL "${rawUrl}" is not in the allowlist for the referenced keys. Check your key settings.`;
            }
          } catch (err: any) {
            return `URL validation error: ${err?.message ?? err}`;
          }
        }

        // Parse headers
        let headers: Record<string, string>;
        try {
          headers = sanitizeOutboundHeaders(JSON.parse(resolvedHeaders));
        } catch {
          return `Invalid headers JSON: ${rawHeaders}`;
        }

        // Make the request
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const fetchOpts: RequestInit = {
            method,
            headers,
            signal: controller.signal,
            redirect: "manual",
          };
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
            if (redirectUrl && (await isBlockedExtensionUrlWithDns(redirectUrl))) {
              return "Redirect to private/internal address blocked.";
            }
            if (redirectUrl && opts.validateUrl && allUsedKeys.length > 0) {
              const allowed = await opts.validateUrl(redirectUrl, allUsedKeys);
              if (!allowed) {
                return "Redirect URL is not in the allowlist for the referenced keys.";
              }
            }
            return `HTTP ${response.status} ${response.statusText}\n\nRedirect: ${
              redirectUrl ? redactString(redirectUrl, secretValues) : "(none)"
            }`;
          }

          let body: string;
          try {
            const result = await readResponseTextWithLimit(
              response,
              MAX_EXTENSION_PROXY_RESPONSE_SIZE,
            );
            body = result.text;
          } catch {
            body = "(could not read response body)";
          }
          body = redactString(body, secretValues);

          // Truncate very long responses for the agent
          if (body.length > 8000) {
            body = body.slice(0, 8000) + "\n... (truncated)";
          }

          // Audit log
          console.log(
            `[fetch-tool] ${method} ${rawUrl} → ${response.status} (${elapsed}ms, keys: ${allUsedKeys.join(",") || "none"})`,
          );

          return `HTTP ${response.status} ${response.statusText}\n\n${body}`;
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
