import { randomBytes } from "node:crypto";
// observed-write-ok: loopback broker only serves bounded reads of one recording
import { createServer } from "node:http";
import type { Socket } from "node:net";

import {
  RecordingMediaFetchError,
  sanitizeRecordingMediaError,
} from "./recording-media-fetch-error.js";

const RANGE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_RANGES = 128;
const MAX_CLIENT_REQUESTS = 32;
const MAX_CONCURRENT_REQUESTS = 2;
export const FRAME_RANGE_DEADLINE_MS = 55_000;
const MAX_HEADER_WAIT_MS = 5_000;
const MAX_CONCURRENT_BROKERS = 2;
let activeBrokers = 0;

export function acquireAgentFrameRangeAdmission(): () => void {
  if (activeBrokers >= MAX_CONCURRENT_BROKERS) {
    throw new RecordingMediaFetchError(
      "Recording range capacity exceeded.",
      503,
    );
  }
  activeBrokers++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeBrokers--;
  };
}

type RangeReader = (range: string, timeoutMs: number) => Promise<Response>;

export type RemoteFrameInput = {
  format: "mov" | "matroska";
  assertHealthy(): Promise<void>;
  remainingMs(): number;
};

/** A loopback-only, single-object source. It never redirects FFmpeg to storage. */
export async function openAgentFrameRange(
  readRange: RangeReader,
  format: RemoteFrameInput["format"],
  deadline = Date.now() + FRAME_RANGE_DEADLINE_MS,
  release = acquireAgentFrameRangeAdmission(),
): Promise<{
  path: string;
  remote: RemoteFrameInput;
  cleanup(): Promise<void>;
}> {
  let failure: RecordingMediaFetchError | undefined;
  let closed = false;
  let totalBytes = 0;
  let rangeCount = 0;
  let requestCount = 0;
  let activeRequests = 0;
  let identity: { etag: string; size: number } | undefined;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const tasks = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const fail = (message: string, status = 502) => {
    failure ??= new RecordingMediaFetchError(message, status);
    return failure;
  };
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw fail("Recording range deadline exceeded.", 504);
    return ms;
  };
  const cancelReaders = () => {
    for (const reader of readers) void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(
    () => {
      if (closed) return;
      fail("Recording range deadline exceeded.", 504);
      cancelReaders();
      for (const socket of sockets) socket.destroy();
    },
    Math.max(0, deadline - Date.now()),
  );

  function assertActive(signal: AbortSignal): void {
    if (closed || signal.aborted) {
      throw new Error("Recording range client disconnected.");
    }
  }

  async function read(start: number, end: number, signal: AbortSignal) {
    assertActive(signal);
    const length = end - start + 1;
    if (++rangeCount > MAX_RANGES || totalBytes + length > MAX_TOTAL_BYTES) {
      throw fail("Recording range budget exceeded.", 413);
    }
    totalBytes += length;
    let response: Response;
    try {
      response = await readRange(
        `bytes=${start}-${end}`,
        Math.min(remaining(), MAX_HEADER_WAIT_MS),
      );
    } catch (error) {
      assertActive(signal);
      const safe = sanitizeRecordingMediaError(error);
      failure ??= safe;
      throw safe;
    }
    if (closed || signal.aborted) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Recording range client disconnected.");
    }
    const etag = response.headers.get("etag");
    const contentRange = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const size = contentRange ? Number(contentRange[3]) : NaN;
    if (
      response.status !== 206 ||
      !etag ||
      !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ||
      !contentRange ||
      Number(contentRange[1]) !== start ||
      Number(contentRange[2]) !== end ||
      !Number.isSafeInteger(size) ||
      size <= end ||
      (identity && (identity.etag !== etag || identity.size !== size)) ||
      !response.body
    ) {
      const status = [401, 403, 404, 410, 413, 504].includes(response.status)
        ? response.status
        : 502;
      const error =
        response.status !== 206
          ? fail("Recording storage returned an invalid range.", status)
          : fail("Recording storage returned an inconsistent range.");
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    identity ??= { etag, size };
    const reader = response.body.getReader();
    readers.add(reader);
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- The signal can abort while the stream is acquired.
    if (signal.aborted) cancel();
    const chunks: Buffer[] = [];
    let received = 0;
    try {
      for (;;) {
        assertActive(signal);
        remaining();
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (error) {
          assertActive(signal);
          const safe = sanitizeRecordingMediaError(error);
          failure ??= safe;
          throw safe;
        }
        assertActive(signal);
        const { done, value } = result;
        if (done) break;
        received += value.byteLength;
        if (received > length)
          throw fail("Recording storage returned an oversized range.");
        chunks.push(Buffer.from(value));
      }
      assertActive(signal);
      remaining();
      if (received !== length)
        throw fail("Recording storage returned a truncated range.");
      return Buffer.concat(chunks, received);
    } finally {
      readers.delete(reader);
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  try {
    await read(0, 0, new AbortController().signal);
    if (!identity) throw fail("Recording storage did not return an identity.");
    const size = identity.size;
    const path = `/${randomBytes(32).toString("hex")}`;
    const server = createServer((request, response) => {
      if (closed || request.socket.destroyed || response.destroyed) {
        response.destroy();
        return;
      }
      if (request.url !== path || request.method !== "GET") {
        response.writeHead(404).end();
        return;
      }
      if (
        ++requestCount > MAX_CLIENT_REQUESTS ||
        activeRequests >= MAX_CONCURRENT_REQUESTS
      ) {
        fail("Recording range request budget exceeded.", 413);
        response.writeHead(503).end();
        return;
      }
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : request.headers.range ? NaN : 0;
      const requestedEnd = range?.[2] ? Number(range[2]) : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(requestedEnd) ||
        start < 0 ||
        start >= size ||
        requestedEnd < start
      ) {
        fail("Invalid recording range request.");
        response.writeHead(416).end();
        return;
      }
      const end = Math.min(requestedEnd, size - 1);
      let disconnected = false;
      const isDisconnected = () => disconnected || closed;
      const controller = new AbortController();
      response.on("error", () => {
        disconnected = true;
        controller.abort();
      });
      response.on("close", () => {
        if (!response.writableFinished) {
          disconnected = true;
          controller.abort();
        }
      });
      activeRequests++;
      const task = (async () => {
        try {
          let offset = start;
          while (offset <= end && !isDisconnected()) {
            const last = Math.min(offset + RANGE_BYTES - 1, end);
            const bytes = await read(offset, last, controller.signal);
            if (!response.headersSent) {
              response.writeHead(206, {
                "Content-Type": "application/octet-stream",
                "Content-Length": end - start + 1,
                "Content-Range": `bytes ${start}-${end}/${size}`,
                "Accept-Ranges": "bytes",
                Connection: "close",
              });
            }
            offset = last + 1;
            if (!response.write(bytes)) {
              await new Promise<void>((resolve) => {
                const done = () => {
                  response.off("drain", done);
                  response.off("close", done);
                  response.off("error", done);
                  resolve();
                };
                response.once("drain", done);
                response.once("close", done);
                response.once("error", done);
              });
            }
          }
          if (!isDisconnected()) response.end();
        } catch {
          if (!isDisconnected()) fail("Recording storage range failed.");
          response.destroy();
        } finally {
          activeRequests--;
        }
      })();
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    });
    server.maxConnections = MAX_CONCURRENT_REQUESTS + 2;
    server.headersTimeout = 5_000;
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not start recording range broker.");
    let cleanupPromise: Promise<void> | undefined;
    return {
      path: `http://127.0.0.1:${address.port}${path}`,
      remote: {
        format,
        remainingMs: remaining,
        assertHealthy: async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          await Promise.allSettled([...tasks]);
          if (failure) throw failure;
        },
      },
      cleanup: () =>
        (cleanupPromise ??= (async () => {
          closed = true;
          cancelReaders();
          for (const socket of sockets) socket.destroy();
          const stopped = new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          try {
            await Promise.allSettled([...tasks]);
            await stopped;
          } finally {
            clearTimeout(timer);
            release();
          }
        })()),
    };
  } catch (error) {
    clearTimeout(timer);
    cancelReaders();
    release();
    throw error;
  }
}
