/**
 * The S3-compatible request layer every S3 provider shares: AWS Signature V4
 * signing for header-signed requests and presigned GET links, plus an
 * SSRF-guarded fetch with connect and idle timeouts.
 *
 * Paths are path-style (`/<bucket>/<key>`), which S3, R2, MinIO and Supabase
 * all accept.
 */

import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "../extensions/url-safety.js";

export interface S3ClientConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
}

export type S3Method = "DELETE" | "GET" | "HEAD" | "POST" | "PUT";

export interface SignedS3RequestOptions {
  method: S3Method;
  query?: Record<string, string>;
  body?: Uint8Array;
  contentType?: string;
  /** An HTTP Range header value, such as `bytes=0-1023`. */
  range?: string;
  timeoutMs: number;
  /**
   * The deployment configured this endpoint (not a workspace), so it may sit
   * on a private network. Without it, only the `S3_ENDPOINT`/`R2_ENDPOINT`
   * origin may.
   */
  trustedEndpoint?: boolean;
}

export interface PresignS3GetOptions {
  /** Seconds until the link stops working: 1 to 604800 (seven days). */
  expiresInSeconds: number;
  /** Overrides the Content-Type the bucket sends with the object. */
  responseContentType?: string;
  /** Overrides the Content-Disposition the bucket sends with the object. */
  responseContentDisposition?: string;
  /** Overrides the Cache-Control the bucket sends with the object. */
  responseCacheControl?: string;
  /** Signing time; tests pin it. Defaults to now. */
  now?: Date;
}

const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function cleanValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

/**
 * The env-configured S3 endpoint origin, when `endpoint` is exactly it. The
 * deployment chose that endpoint, so it may sit on a private network (a
 * self-hosted MinIO, for example); endpoints saved in workspace settings may
 * not.
 */
export function trustedDeploymentS3Origin(
  endpoint: string,
): string | undefined {
  const configuredEndpoint =
    cleanValue(process.env.S3_ENDPOINT) ?? cleanValue(process.env.R2_ENDPOINT);
  if (!configuredEndpoint) return undefined;
  if (!URL.canParse(endpoint) || !URL.canParse(configuredEndpoint)) {
    return undefined;
  }
  const endpointUrl = new URL(endpoint);
  const configuredUrl = new URL(configuredEndpoint);
  const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";
  if (
    endpointUrl.origin !== configuredUrl.origin ||
    normalizePath(endpointUrl.pathname) !==
      normalizePath(configuredUrl.pathname) ||
    endpointUrl.search !== configuredUrl.search ||
    endpointUrl.username !== configuredUrl.username ||
    endpointUrl.password !== configuredUrl.password
  ) {
    return undefined;
  }
  return endpointUrl.origin;
}

/**
 * Fetches an S3 URL through the SSRF guard. `timeoutMs` bounds the wait for
 * response headers and then each gap between body chunks, so a hung endpoint
 * can't hold a request open forever.
 */
export async function fetchS3WithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  trustedPrivateOrigin?: string,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const createTimeoutError = () => {
    const error = new Error(
      `S3 request timed out after ${timeoutMs}ms: ${init.method ?? "GET"} ${url}`,
    );
    error.name = "TimeoutError";
    return error;
  };
  const clearTimeoutIfRunning = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const timeoutError = createTimeoutError();
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const request = (async () => {
      const isPrivateDestination = await isBlockedExtensionUrlWithDns(url);
      if (controller.signal.aborted) throw controller.signal.reason;
      const allowedPrivateOrigins =
        isPrivateDestination &&
        trustedPrivateOrigin === new URL(url).origin &&
        trustedPrivateOrigin
          ? [trustedPrivateOrigin]
          : [];
      if (isPrivateDestination && allowedPrivateOrigins.length === 0) {
        throw new Error(
          `SSRF blocked: refusing to fetch private/internal S3 endpoint (${url})`,
        );
      }
      return ssrfSafeFetch(
        url,
        {
          ...init,
          signal: controller.signal,
        },
        {
          followRedirects: false,
          requireDispatcher: true,
          allowedPrivateOrigins,
        },
      );
    })();
    const response = await Promise.race([request, timeoutPromise]);
    clearTimeoutIfRunning();
    if (!response.body) {
      return response;
    }

    const reader = response.body.getReader();
    let idleTimeout: ReturnType<typeof setTimeout> | undefined;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let bodySettled = false;
    const clearIdleTimeout = () => {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = undefined;
      }
    };
    const timeOutBody = () => {
      if (bodySettled) return;
      const timeoutError = createTimeoutError();
      bodySettled = true;
      clearIdleTimeout();
      controller.abort(timeoutError);
      bodyController?.error(timeoutError);
    };
    const resetIdleTimeout = () => {
      clearIdleTimeout();
      idleTimeout = setTimeout(timeOutBody, timeoutMs);
      if (idleTimeout.unref) idleTimeout.unref();
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(streamController) {
          bodyController = streamController;
          resetIdleTimeout();
        },
        async pull(streamController) {
          try {
            if (controller.signal.aborted) throw controller.signal.reason;
            const { done, value } = await reader.read();
            if (bodySettled) return;
            if (controller.signal.aborted) throw controller.signal.reason;
            if (done) {
              bodySettled = true;
              clearIdleTimeout();
              streamController.close();
            } else {
              streamController.enqueue(value);
              resetIdleTimeout();
            }
          } catch (error) {
            if (bodySettled) return;
            bodySettled = true;
            clearIdleTimeout();
            streamController.error(
              controller.signal.aborted ? controller.signal.reason : error,
            );
          }
        },
        async cancel(reason) {
          bodySettled = true;
          clearIdleTimeout();
          await reader.cancel(reason);
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    clearTimeoutIfRunning();
    if (err instanceof Error && err.name === "TimeoutError") {
      throw createTimeoutError();
    }
    if (err instanceof Error && err.name === "AbortError") {
      const abortError = new Error(
        `S3 request aborted (timeout ${timeoutMs}ms): ${init.method ?? "GET"} ${url}`,
      );
      abortError.name = "AbortError";
      throw abortError;
    }
    throw err;
  }
}

/** Releases a response body the caller doesn't need. */
export async function cancelS3ResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return toHex(await crypto.subtle.digest("SHA-256", buffer));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
): Promise<ArrayBuffer> {
  const dateKey = await hmac(
    new TextEncoder().encode(`AWS4${secret}`).buffer as ArrayBuffer,
    dateStamp,
  );
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

/** URI-encodes one value the way SigV4 requires (RFC 3986 unreserved set). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The canonical path-style URI for an object, refusing dot segments. */
export function s3ObjectUri(
  config: Pick<S3ClientConfig, "bucket">,
  key: string,
) {
  const keySegments = key.split("/");
  if (
    config.bucket.includes("/") ||
    config.bucket.includes("\\") ||
    config.bucket === "." ||
    config.bucket === ".." ||
    keySegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("S3 object path contains an unsafe URL path segment");
  }
  return `/${rfc3986(config.bucket)}/${keySegments.map(rfc3986).join("/")}`;
}

function canonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const left = leftKey === rightKey ? leftValue : leftKey;
      const right = leftKey === rightKey ? rightValue : rightKey;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function amzTimestamp(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** The endpoint's base path (for endpoints mounted under a path), no trailing slash. */
function endpointBase(config: S3ClientConfig): {
  origin: string;
  path: string;
} {
  const url = new URL(config.endpoint);
  return { origin: url.origin, path: url.pathname.replace(/\/+$/, "") };
}

export interface SignedS3Headers {
  url: string;
  headers: Record<string, string>;
}

/** Signs a request with an `Authorization` header (SigV4). */
export async function signS3Request(
  config: S3ClientConfig,
  key: string,
  options: Omit<SignedS3RequestOptions, "timeoutMs"> & { now?: Date },
): Promise<SignedS3Headers> {
  const { amzDate, dateStamp } = amzTimestamp(options.now ?? new Date());
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const base = endpointBase(config);
  const host = new URL(config.endpoint).host;
  const canonicalUri = `${base.path}${s3ObjectUri(config, key)}`;
  const canonicalQuery = canonicalQueryString(options.query ?? {});
  const payloadHash = await sha256Hex(options.body ?? new Uint8Array(0));

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (options.contentType) headers["content-type"] = options.contentType;
  if (options.range?.startsWith("bytes=")) headers.range = options.range;

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders =
    signedHeaderKeys
      .map((header) => `${header}:${headers[header]}`)
      .join("\n") + "\n";
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");
  const signature = toHex(
    await hmac(
      await deriveSigningKey(config.secretAccessKey, dateStamp, config.region),
      stringToSign,
    ),
  );
  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${base.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
    headers,
  };
}

/** Sends a SigV4-signed request through the SSRF guard. */
export async function signedS3Request(
  config: S3ClientConfig,
  key: string,
  options: SignedS3RequestOptions,
): Promise<Response> {
  const { url, headers } = await signS3Request(config, key, options);
  return fetchS3WithTimeout(
    url,
    {
      method: options.method,
      headers,
      ...(options.body
        ? {
            body: options.body.buffer.slice(
              options.body.byteOffset,
              options.body.byteOffset + options.body.byteLength,
            ) as BodyInit,
          }
        : {}),
    },
    options.timeoutMs,
    options.trustedEndpoint
      ? new URL(config.endpoint).origin
      : trustedDeploymentS3Origin(config.endpoint),
  );
}

/**
 * Returns a GET link for one object that works without credentials until it
 * expires (SigV4 query signing). Anyone holding the link can read the object
 * until then, so keep the expiry short.
 */
export async function presignS3GetUrl(
  config: S3ClientConfig,
  key: string,
  options: PresignS3GetOptions,
): Promise<string> {
  const expires = Math.floor(options.expiresInSeconds);
  if (
    !Number.isFinite(expires) ||
    expires < 1 ||
    expires > MAX_PRESIGN_SECONDS
  ) {
    throw new Error(
      `S3 presigned links expire after 1 to ${MAX_PRESIGN_SECONDS} seconds`,
    );
  }
  const { amzDate, dateStamp } = amzTimestamp(options.now ?? new Date());
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const base = endpointBase(config);
  const host = new URL(config.endpoint).host;
  const canonicalUri = `${base.path}${s3ObjectUri(config, key)}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  if (options.responseContentType) {
    query["response-content-type"] = options.responseContentType;
  }
  if (options.responseContentDisposition) {
    query["response-content-disposition"] = options.responseContentDisposition;
  }
  if (options.responseCacheControl) {
    query["response-cache-control"] = options.responseCacheControl;
  }
  const canonicalQuery = canonicalQueryString(query);
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");
  const signature = toHex(
    await hmac(
      await deriveSigningKey(config.secretAccessKey, dateStamp, config.region),
      stringToSign,
    ),
  );
  return `${base.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
