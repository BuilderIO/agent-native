import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { openAgentFrameRange } from "./agent-frame-range.js";
import { extractJpegFrameFromFile } from "./video-frame.js";

function response(
  bytes: Uint8Array,
  range: string,
  etag = '"one"',
  status = 206,
) {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { etag, "content-range": range },
  });
}

describe("recording range broker", () => {
  it.each([
    [
      "changed ETag",
      () => response(Buffer.from("abcd"), "bytes 0-3/4", '"two"'),
    ],
    [
      "weak ETag",
      () => response(Buffer.from("abcd"), "bytes 0-3/4", 'W/"one"'),
    ],
    [
      "missing ETag",
      () =>
        new Response("abcd", {
          status: 206,
          headers: { "content-range": "bytes 0-3/4" },
        }),
    ],
    ["wrong size", () => response(Buffer.from("abcd"), "bytes 0-3/5")],
    ["wrong range", () => response(Buffer.from("abcd"), "bytes 1-4/5")],
    [
      "non-range response",
      () => response(Buffer.from("abcd"), "bytes 0-3/4", '"one"', 200),
    ],
    ["truncated body", () => response(Buffer.from("abc"), "bytes 0-3/4")],
    ["extra body", () => response(Buffer.from("abcde"), "bytes 0-3/4")],
  ])(
    "rejects %s without serving its partial bytes",
    async (_name, badResponse) => {
      let count = 0;
      const media = await openAgentFrameRange(
        async () =>
          ++count === 1
            ? response(Buffer.from("a"), "bytes 0-0/4")
            : badResponse(),
        "mov",
      );
      try {
        expect((await fetch(`${media.path}-wrong`)).status).toBe(404);
        await expect(
          fetch(media.path, { headers: { range: "bytes=0-3" } }),
        ).rejects.toThrow();
        await expect(media.remote.assertHealthy()).rejects.toThrow(/range/i);
      } finally {
        await media.cleanup();
      }
    },
  );

  it("cancels a body that resolves after its client disconnects and waits for the request", async () => {
    let release: ((response: Response) => void) | undefined;
    let canceled = false;
    let count = 0;
    let headerTimeoutMs = 0;
    const media = await openAgentFrameRange(async (_range, timeoutMs) => {
      if (++count === 1) return response(Buffer.from("a"), "bytes 0-0/4");
      headerTimeoutMs = timeoutMs;
      return await new Promise<Response>((resolve) => {
        release = resolve;
      });
    }, "mov");
    const controller = new AbortController();
    const request = fetch(media.path, { signal: controller.signal }).catch(
      () => null,
    );
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    expect(headerTimeoutMs).toBeLessThanOrEqual(5_000);
    controller.abort();
    await request;
    const cleanup = media.cleanup();
    release(
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        {
          status: 206,
          headers: { etag: '"one"', "content-range": "bytes 0-3/4" },
        },
      ),
    );
    await cleanup;
    expect(canceled).toBe(true);
  });

  it("drains a pending upstream rejection after broker cleanup starts without poisoning health", async () => {
    let rejectRange: ((error: Error) => void) | undefined;
    let count = 0;
    const media = await openAgentFrameRange(async () => {
      if (++count === 1) return response(Buffer.from("a"), "bytes 0-0/4");
      return await new Promise<Response>((_resolve, reject) => {
        rejectRange = reject;
      });
    }, "mov");
    const request = fetch(media.path).catch(() => null);
    while (!rejectRange) await new Promise((resolve) => setImmediate(resolve));
    const cleanup = media.cleanup();
    rejectRange(new Error("late upstream failure"));
    await cleanup;
    await request;
    await expect(media.remote.assertHealthy()).resolves.toBeUndefined();
    await expect(fetch(media.path)).rejects.toThrow();
  });

  it("cancels an active upstream body on unexpected client disconnect and closes the broker", async () => {
    let count = 0;
    let started!: () => void;
    let canceled!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const bodyCanceled = new Promise<void>((resolve) => {
      canceled = resolve;
    });
    const media = await openAgentFrameRange(async () => {
      if (++count === 1) return response(Buffer.from("a"), "bytes 0-0/4");
      return new Response(
        new ReadableStream({
          start() {
            started();
          },
          cancel() {
            canceled();
          },
        }),
        {
          status: 206,
          headers: { etag: '"one"', "content-range": "bytes 0-3/4" },
        },
      );
    }, "mov");
    const controller = new AbortController();
    const request = fetch(media.path, { signal: controller.signal }).catch(
      () => null,
    );
    try {
      await bodyStarted;
      controller.abort();
      await request;
      await bodyCanceled;
      await media.remote.assertHealthy();
    } finally {
      await media.cleanup();
    }
    await expect(fetch(media.path)).rejects.toThrow();
    const fresh = await openAgentFrameRange(
      async () => response(Buffer.from("a"), "bytes 0-0/4"),
      "mov",
    );
    await fresh.cleanup();
  });

  it("cancels a stalled range body at the overall deadline", async () => {
    vi.useFakeTimers();
    let canceled = false;
    try {
      const opening = openAgentFrameRange(
        async () =>
          new Response(
            new ReadableStream({
              cancel() {
                canceled = true;
              },
            }),
            {
              status: 206,
              headers: { etag: '"one"', "content-range": "bytes 0-0/4" },
            },
          ),
        "mov",
      );
      const rejected = expect(opening).rejects.toThrow(/deadline/i);
      await vi.advanceTimersByTimeAsync(55_000);
      await rejected;
      expect(canceled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds concurrent brokers and releases capacity at cleanup", async () => {
    const reader = async () => response(Buffer.from("a"), "bytes 0-0/4");
    const first = await openAgentFrameRange(reader, "mov");
    const second = await openAgentFrameRange(reader, "mov");
    try {
      await expect(openAgentFrameRange(reader, "mov")).rejects.toThrow(
        /capacity/i,
      );
      await first.cleanup();
      const third = await openAgentFrameRange(reader, "mov");
      await third.cleanup();
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it("keeps a completed frame when a pending range rejects after FFmpeg disconnects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-range-disconnect-"));
    const previous = process.env.FFMPEG_PATH;
    let rejectRange: ((error: Error) => void) | undefined;
    try {
      const command = join(dir, "ffmpeg");
      const marker = join(dir, "disconnected");
      await writeFile(
        command,
        `#!/usr/bin/env node\nconst http = require('node:http');\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nconst input = args[args.indexOf('-i') + 1];\nhttp.get(input, res => { let n = 0; res.on('data', chunk => { n += chunk.length; if (n >= 1048576) { res.destroy(); fs.writeFileSync(args[args.length - 1], Buffer.from([255,216,255,217])); fs.writeFileSync(${JSON.stringify(marker)}, 'done'); process.exit(0); } }); });\n`,
      );
      await chmod(command, 0o755);
      process.env.FFMPEG_PATH = command;
      let count = 0;
      const total = 2 * 1024 * 1024;
      const media = await openAgentFrameRange(async () => {
        count++;
        if (count === 1)
          return response(Buffer.from("a"), `bytes 0-0/${total}`);
        if (count === 2)
          return response(
            Buffer.alloc(1024 * 1024),
            `bytes 0-1048575/${total}`,
          );
        return await new Promise<Response>((_resolve, reject) => {
          rejectRange = reject;
        });
      }, "mov");
      try {
        const result = extractJpegFrameFromFile({
          mediaPath: media.path,
          atMs: 0,
          remote: media.remote,
        });
        while (!rejectRange || !existsSync(marker))
          await new Promise((resolve) => setImmediate(resolve));
        expect((await fetch(`${media.path}-wrong`)).status).toBe(404);
        await new Promise((resolve) => setImmediate(resolve));
        rejectRange(new Error("late upstream failure"));
        expect(Buffer.from(await result)).toEqual(
          Buffer.from([255, 216, 255, 217]),
        );
        await expect(media.remote.assertHealthy()).resolves.toBeUndefined();
      } finally {
        rejectRange?.(new Error("test cleanup"));
        await media.cleanup();
      }
    } finally {
      if (previous === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects FFmpeg success after the request budget is exhausted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-range-budget-"));
    const previous = process.env.FFMPEG_PATH;
    try {
      const command = join(dir, "ffmpeg");
      await writeFile(
        command,
        `#!/usr/bin/env node\nconst http = require('node:http');\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nconst input = args[args.indexOf('-i') + 1];\nlet n = 0;\nfunction next() { if (++n > 33) { fs.writeFileSync(args[args.length - 1], Buffer.from([255,216,255,217])); return; } http.get(input, r => { r.resume(); r.on('end', next); }).on('error', next); }\nnext();\n`,
      );
      await chmod(command, 0o755);
      process.env.FFMPEG_PATH = command;
      const media = await openAgentFrameRange(
        async (range) =>
          range === "bytes=0-0"
            ? response(Buffer.from("a"), "bytes 0-0/4")
            : response(Buffer.from("abcd"), "bytes 0-3/4"),
        "mov",
      );
      try {
        await expect(
          extractJpegFrameFromFile({
            mediaPath: media.path,
            atMs: 0,
            remote: media.remote,
          }),
        ).rejects.toThrow(/budget/i);
      } finally {
        await media.cleanup();
      }
    } finally {
      if (previous === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects FFmpeg success when a range fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-range-ffmpeg-"));
    const previous = process.env.FFMPEG_PATH;
    try {
      const command = join(dir, "ffmpeg");
      await writeFile(
        command,
        `#!/usr/bin/env node\nconst http = require('node:http');\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nconst input = args[args.indexOf('-i') + 1];\nhttp.get(input, response => { response.resume(); response.on('end', done); }).on('error', done);\nfunction done() { fs.writeFileSync(args[args.length - 1], Buffer.from([255,216,255,217])); process.exit(0); }\n`,
      );
      await chmod(command, 0o755);
      process.env.FFMPEG_PATH = command;
      let count = 0;
      const media = await openAgentFrameRange(
        async () =>
          ++count === 1
            ? response(Buffer.from("a"), "bytes 0-0/4")
            : response(Buffer.from("abcd"), "bytes 0-3/4", '"changed"'),
        "mov",
      );
      try {
        await expect(
          extractJpegFrameFromFile({
            mediaPath: media.path,
            atMs: 0,
            remote: media.remote,
          }),
        ).rejects.toThrow(/range/i);
      } finally {
        await media.cleanup();
      }
    } finally {
      if (previous === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
