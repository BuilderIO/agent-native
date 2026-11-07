import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";

const RANGE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_RANGES = 128;
const MAX_CLIENT_REQUESTS = 32;
const MAX_CONCURRENT_REQUESTS = 2;
const DEADLINE_MS = 90_000;
const MAX_CONCURRENT_BROKERS = 2;
let activeBrokers = 0;

type RangeReader = (range: string, timeoutMs: number) => Promise<Response>;

export type RemoteFrameInput = {
  format: "mov" | "matroska";
  assertHealthy(): Promise<void>;
};

/** A loopback-only, single-object source. It never redirects FFmpeg to storage. */
export async function openAgentFrameRange(
  readRange: RangeReader,
  format: RemoteFrameInput["format"],
): Promise<{
  path: string;
  remote: RemoteFrameInput;
  cleanup(): Promise<void>;
}> {
  if (activeBrokers >= MAX_CONCURRENT_BROKERS) {
    throw new Error("Recording range capacity exceeded.");
  }
  activeBrokers++;
  const deadline = Date.now() + DEADLINE_MS;
  let failure: Error | undefined;
  let closed = false;
  let totalBytes = 0;
  let rangeCount = 0;
  let requestCount = 0;
  let activeRequests = 0;
  let identity: { etag: string; size: number } | undefined;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const tasks = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const fail = (message: string) => {
    failure ??= new Error(message);
    return failure;
  };
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw fail("Recording range deadline exceeded.");
    return ms;
  };
  const cancelReaders = () => {
    for (const reader of readers) void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(() => {
    fail("Recording range deadline exceeded.");
    cancelReaders();
    for (const socket of sockets) socket.destroy();
  }, DEADLINE_MS);

  async function read(start: number, end: number, signal: AbortSignal) {
    const length = end - start + 1;
    if (++rangeCount > MAX_RANGES || totalBytes + length > MAX_TOTAL_BYTES) {
      throw fail("Recording range budget exceeded.");
    }
    totalBytes += length;
    const response = await readRange(`bytes=${start}-${end}`, remaining());
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
      await response.body?.cancel().catch(() => {});
      throw fail("Recording storage returned an inconsistent range.");
    }
    identity ??= { etag, size };
    const reader = response.body.getReader();
    readers.add(reader);
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const chunks: Buffer[] = [];
    let received = 0;
    try {
      while (true) {
        remaining();
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > length)
          throw fail("Recording storage returned an oversized range.");
        chunks.push(Buffer.from(value));
      }
      if (closed || signal.aborted)
        throw new Error("Recording range client disconnected.");
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
      if (request.url !== path || request.method !== "GET") {
        response.writeHead(404).end();
        return;
      }
      if (
        ++requestCount > MAX_CLIENT_REQUESTS ||
        activeRequests >= MAX_CONCURRENT_REQUESTS
      ) {
        fail("Recording range request budget exceeded.");
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
          while (offset <= end && !disconnected && !closed) {
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
          if (!disconnected && !closed) response.end();
        } catch {
          if (!disconnected && !closed) fail("Recording storage range failed.");
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
            activeBrokers--;
          }
        })()),
    };
  } catch (error) {
    clearTimeout(timer);
    cancelReaders();
    activeBrokers--;
    throw error;
  }
}
