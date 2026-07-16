import { describe, expect, it, vi } from "vitest";

import { readPrivateVaultBoundedBody } from "./private-vault-bounded-body.js";

function eventWith(chunks: Uint8Array[]) {
  return {
    req: {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
        cancel: vi.fn(),
      }),
    },
  } as never;
}

describe("readPrivateVaultBoundedBody", () => {
  it("joins an exact bounded stream", async () => {
    await expect(
      readPrivateVaultBoundedBody(
        eventWith([new Uint8Array([1, 2]), new Uint8Array([3])]),
        3,
        4,
      ),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects an actual chunked overrun before consuming the full body", async () => {
    await expect(
      readPrivateVaultBoundedBody(
        eventWith([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
        3,
        3,
      ),
    ).rejects.toThrow(/exceeded/i);
  });

  it("fails closed without a streaming request body", async () => {
    await expect(
      readPrivateVaultBoundedBody({ req: {} } as never, 1, 1),
    ).rejects.toThrow(/stream is unavailable/i);
  });
});
