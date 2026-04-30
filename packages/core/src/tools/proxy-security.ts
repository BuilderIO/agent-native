const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const BLOCKED_OUTBOUND_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

export const MAX_TOOL_PROXY_RESPONSE_SIZE = 1024 * 1024;

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);

export function normalizeToolProxyMethod(value: unknown): string | null {
  const method = String(value || "GET").toUpperCase();
  return ALLOWED_METHODS.has(method) ? method : null;
}

export function sanitizeOutboundHeaders(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const headers: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME_RE.test(name) || BLOCKED_OUTBOUND_HEADERS.has(lower)) {
      continue;
    }
    if (rawValue === undefined || rawValue === null) continue;
    const headerValue = String(rawValue);
    if (/[\r\n]/.test(headerValue)) continue;
    headers[name] = headerValue;
  }
  return headers;
}

export function collectSecretValues(
  ...groups: Array<Array<string> | undefined>
): string[] {
  const values = new Set<string>();
  for (const group of groups) {
    for (const value of group ?? []) {
      if (value) values.add(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function redactSecrets<T>(value: T, secretValues: string[]): T {
  if (secretValues.length === 0) return value;
  if (typeof value === "string") {
    return redactString(value, secretValues) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secretValues)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactSecrets(entry, secretValues),
      ]),
    ) as T;
  }
  return value;
}

export function redactString(text: string, secretValues: string[]): string {
  let out = text;
  for (const secret of secretValues) {
    for (const candidate of redactionCandidates(secret)) {
      if (candidate) out = out.split(candidate).join("[redacted]");
    }
  }
  return out;
}

function redactionCandidates(secret: string): string[] {
  const candidates = new Set([secret]);
  try {
    candidates.add(encodeURIComponent(secret));
  } catch {}
  try {
    candidates.add(encodeURI(secret));
  } catch {}
  return [...candidates].sort((a, b) => b.length - a.length);
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes = MAX_TOOL_PROXY_RESPONSE_SIZE,
): Promise<{ text: string; truncated: boolean; size: number }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return {
      text: `(response too large - ${contentLength} bytes, max ${maxBytes})`,
      truncated: true,
      size: Number(contentLength),
    };
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return {
        text: `(response truncated - ${buffer.byteLength} bytes, max ${maxBytes})`,
        truncated: true,
        size: buffer.byteLength,
      };
    }
    return {
      text: new TextDecoder().decode(buffer),
      truncated: false,
      size: buffer.byteLength,
    };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return {
        text: `(response truncated - ${total} bytes, max ${maxBytes})`,
        truncated: true,
        size: total,
      };
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    text: new TextDecoder().decode(buffer),
    truncated: false,
    size: total,
  };
}
