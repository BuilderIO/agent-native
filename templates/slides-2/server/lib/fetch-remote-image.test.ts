import { EventEmitter } from "node:events";
import http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchRemoteImage,
  normalizeRemoteImageContentType,
  publicOnlyLookup,
} from "./fetch-remote-image.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function lookupResult(
  hostname: string,
  options: Record<string, unknown> = {},
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown }> {
  return new Promise((resolve) => {
    (
      publicOnlyLookup as unknown as (
        host: string,
        opts: Record<string, unknown>,
        cb: (err: NodeJS.ErrnoException | null, address: unknown) => void,
      ) => void
    )(hostname, options, (err, address) => resolve({ err, address }));
  });
}

describe("publicOnlyLookup", () => {
  it("refuses a hostname that resolves to loopback", async () => {
    const { err } = await lookupResult("localhost");
    expect(err?.code).toBe("EBLOCKED");
  });

  it("refuses loopback even when all addresses are requested", async () => {
    const { err } = await lookupResult("localhost", { all: true });
    expect(err?.code).toBe("EBLOCKED");
  });
});

describe("fetchRemoteImage", () => {
  it("refuses a loopback literal before opening a socket", async () => {
    const result = await fetchRemoteImage("http://127.0.0.1:9/secret.png");
    expect(result).toEqual({ ok: false, reason: "unsupported-url" });
  });

  it("refuses the cloud metadata address", async () => {
    const result = await fetchRemoteImage(
      "http://169.254.169.254/latest/meta-data/",
    );
    expect(result).toEqual({ ok: false, reason: "unsupported-url" });
  });

  it("refuses a non-http scheme", async () => {
    const result = await fetchRemoteImage("file:///etc/passwd");
    expect(result).toEqual({ ok: false, reason: "unsupported-url" });
  });

  it("refuses a hostname whose only addresses are private", async () => {
    const result = await fetchRemoteImage("http://localhost.localdomain/a.png");
    expect(result.ok).toBe(false);
  });

  it("aborts a slow-drip response at the total request deadline", async () => {
    vi.useFakeTimers();
    let dripCount = 0;
    let requestCount = 0;
    const fakeRequest = (
      _target: URL,
      options: http.RequestOptions,
      callback?: (response: http.IncomingMessage) => void,
    ) => {
      const request = new EventEmitter() as EventEmitter & {
        destroy: (error?: Error) => void;
        end: () => void;
        setTimeout: () => void;
      };
      const response = new EventEmitter() as EventEmitter & {
        destroy: (error?: Error) => void;
        headers: http.IncomingHttpHeaders;
        statusCode: number;
      };
      let drip: ReturnType<typeof setInterval> | undefined;
      const signal = (
        options as http.RequestOptions & {
          signal: AbortSignal;
        }
      ).signal;

      request.destroy = (error) => {
        if (error) queueMicrotask(() => request.emit("error", error));
      };
      request.end = () => {
        if (requestCount++ === 0) {
          response.statusCode = 302;
          response.headers = { location: "/redirected.png" };
          setTimeout(() => callback?.(response as http.IncomingMessage), 8_000);
          return;
        }
        queueMicrotask(() => callback?.(response as http.IncomingMessage));
        drip = setInterval(() => {
          dripCount += 1;
          response.emit("data", Buffer.from("x"));
        }, 1_000);
      };
      request.setTimeout = () => undefined;
      if (requestCount > 0) {
        response.statusCode = 200;
        response.headers = { "content-type": "image/png" };
      }
      response.destroy = (error) => {
        if (drip) clearInterval(drip);
        if (error) queueMicrotask(() => response.emit("error", error));
      };
      signal.addEventListener(
        "abort",
        () => request.destroy(new Error("Request aborted")),
        { once: true },
      );
      return request as unknown as http.ClientRequest;
    };
    const requestMock = vi
      .spyOn(http, "request")
      .mockImplementation(fakeRequest as typeof http.request);

    const resultPromise = fetchRemoteImage("http://example.com/image.png");
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: "fetch-failed",
    });
    expect(dripCount).toBeGreaterThanOrEqual(5);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

describe("normalizeRemoteImageContentType", () => {
  it.each([
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpg",
    "image/jpeg",
    "image/png",
    "image/vnd.microsoft.icon",
    "image/webp",
    "image/x-icon",
  ])("accepts supported raster MIME type %s", (contentType) => {
    expect(normalizeRemoteImageContentType(contentType)).toBe(contentType);
  });

  it("normalizes a supported MIME type and ignores parameters", () => {
    expect(
      normalizeRemoteImageContentType(" IMAGE/PNG ; charset=binary "),
    ).toBe("image/png");
  });

  it("rejects SVG", () => {
    expect(normalizeRemoteImageContentType("image/svg+xml")).toBeNull();
  });

  it("rejects unknown image MIME types", () => {
    expect(normalizeRemoteImageContentType("image/x-unknown")).toBeNull();
  });
});
