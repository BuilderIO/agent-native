import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { SwiftDesktopHelperClient } from "./helper-client";
import type { MutationOperation } from "./types";

function fakeChild(
  respond: boolean,
  exitDelayMs = 0,
): ChildProcessWithoutNullStreams & { kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    setTimeout(() => child.emit("exit", null, "SIGKILL"), exitDelayMs);
    return true;
  });
  child.stdin.on("data", (chunk: Buffer) => {
    if (!respond) return;
    const request = JSON.parse(chunk.toString()) as { id: number };
    setTimeout(() => {
      child.stdout.write(`${JSON.stringify({ id: request.id, ok: true })}\n`);
    }, 20);
  });
  return child as ChildProcessWithoutNullStreams & {
    kill: ReturnType<typeof vi.fn>;
  };
}

describe("SwiftDesktopHelperClient preemption", () => {
  it("kills an in-flight helper on abort and uses a fresh process for releaseAll", async () => {
    const first = fakeChild(false, 10);
    const second = fakeChild(true);
    const spawnHelper = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const helper = new SwiftDesktopHelperClient(
      "/fixed/helper/path",
      spawnHelper,
    );
    const controller = new AbortController();
    const operation: MutationOperation = {
      kind: "input.click",
      taskId: "run-1",
      leaseToken: "lease",
      target: {
        snapshotId: "snapshot",
        nodeId: "button",
        bundleId: "com.example.App",
      },
    };

    const mutation = helper.mutate(
      operation,
      { bundleIds: ["com.example.App"], origins: [] },
      controller.signal,
    );
    controller.abort(new Error("emergency stop"));
    await expect(mutation).rejects.toThrow("emergency stop");
    expect(first.kill).toHaveBeenCalledWith("SIGKILL");

    await expect(helper.releaseAll()).resolves.toBeUndefined();
    expect(spawnHelper).toHaveBeenCalledTimes(2);
    helper.close();
  });
});
