import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import {
  isPrivateAddress,
  MAX_PROXIED_IMAGE_BYTES,
  MAX_PROXY_REDIRECTS,
  parseProxyableImageUrl,
} from "./image-proxy-url.js";

export type RemoteImageFailure =
  | "unsupported-url"
  | "blocked-address"
  | "fetch-failed"
  | "too-many-redirects"
  | "not-an-image"
  | "too-large";

export type RemoteImageResult =
  | { ok: true; contentType: string; body: Buffer }
  | { ok: false; reason: RemoteImageFailure };

const REQUEST_TIMEOUT_MS = 15_000;
const REMOTE_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpg",
  "image/jpeg",
  "image/png",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);

export function normalizeRemoteImageContentType(
  contentType: string,
): string | null {
  const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return REMOTE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}

/**
 * A `lookup` implementation that only ever hands the socket an address we have
 * classified as public.
 *
 * Validating the hostname separately and then calling `fetch` leaves a gap: the
 * two resolutions are independent, so a DNS-rebinding host can answer with a
 * public address for the check and a loopback or metadata address for the
 * actual connection. Because Node passes this straight to `net.connect`, the
 * address that is checked here is the address that gets dialled.
 */
export const publicOnlyLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  const wantsAll =
    typeof options === "object" && options !== null && options.all === true;
  const hints = typeof options === "object" && options !== null ? options : {};

  dnsLookup(hostname, { ...hints, all: true }, (err, addresses) => {
    if (err) {
      (callback as (e: NodeJS.ErrnoException) => void)(err);
      return;
    }
    const safe = (addresses as LookupAddress[]).filter(
      (entry) => !isPrivateAddress(entry.address),
    );
    if (safe.length === 0) {
      const blocked: NodeJS.ErrnoException = new Error(
        `Refusing to connect to a non-public address for ${hostname}`,
      );
      blocked.code = "EBLOCKED";
      (callback as (e: NodeJS.ErrnoException) => void)(blocked);
      return;
    }
    if (wantsAll) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(
        null,
        safe,
      );
      return;
    }
    callback(null, safe[0].address, safe[0].family);
  });
};

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  read: () => Promise<Buffer | "too-large">;
  discard: () => void;
}

function requestHop(target: URL, signal: AbortSignal): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(
      target,
      {
        method: "GET",
        headers: { Accept: "image/*" },
        lookup: publicOnlyLookup,
        signal,
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          discard: () => response.destroy(),
          read: () =>
            new Promise<Buffer | "too-large">((resolveBody, rejectBody) => {
              const chunks: Buffer[] = [];
              let total = 0;
              let settled = false;
              const cleanup = () => {
                signal.removeEventListener("abort", onAbort);
              };
              const finish = (body: Buffer | "too-large") => {
                if (settled) return;
                settled = true;
                cleanup();
                resolveBody(body);
              };
              const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                rejectBody(error);
              };
              const onAbort = () => {
                const error =
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error("Timed out fetching image");
                response.destroy(error);
                fail(error);
              };

              response.on("error", fail);
              if (signal.aborted) {
                onAbort();
                return;
              }
              signal.addEventListener("abort", onAbort, { once: true });
              response.on("data", (chunk: Buffer) => {
                if (settled) return;
                total += chunk.length;
                if (total > MAX_PROXIED_IMAGE_BYTES) {
                  response.destroy();
                  finish("too-large");
                  return;
                }
                chunks.push(chunk);
              });
              response.on("end", () => finish(Buffer.concat(chunks)));
            }),
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Timed out fetching image"));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchRemoteImage(
  raw: string,
): Promise<RemoteImageResult> {
  const firstTarget = parseProxyableImageUrl(raw);
  if (!firstTarget) return { ok: false, reason: "unsupported-url" };
  let target: URL = firstTarget;
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("Timed out fetching image")),
    REQUEST_TIMEOUT_MS,
  );

  try {
    for (let hop = 0; hop <= MAX_PROXY_REDIRECTS; hop++) {
      let response: HopResult;
      try {
        response = await requestHop(target, controller.signal);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        return {
          ok: false,
          reason: code === "EBLOCKED" ? "blocked-address" : "fetch-failed",
        };
      }

      if (response.status >= 300 && response.status < 400) {
        response.discard();
        const location = response.headers.location;
        const next: URL | null = location
          ? parseProxyableImageUrl(new URL(location, target).href)
          : null;
        if (!next) return { ok: false, reason: "fetch-failed" };
        target = next;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.discard();
        return { ok: false, reason: "fetch-failed" };
      }

      const contentType = normalizeRemoteImageContentType(
        String(response.headers["content-type"] ?? ""),
      );
      if (!contentType) {
        response.discard();
        return { ok: false, reason: "not-an-image" };
      }

      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_PROXIED_IMAGE_BYTES) {
        response.discard();
        return { ok: false, reason: "too-large" };
      }

      let body: Buffer | "too-large";
      try {
        body = await response.read();
      } catch {
        // coercion-ok: a truncated transfer has no partial-success form here;
        // the caller answers 502 either way.
        return { ok: false, reason: "fetch-failed" };
      }
      if (body === "too-large") return { ok: false, reason: "too-large" };

      return { ok: true, contentType, body };
    }

    return { ok: false, reason: "too-many-redirects" };
  } finally {
    clearTimeout(deadline);
  }
}
