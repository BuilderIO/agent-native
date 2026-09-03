import { describe, expect, it, vi } from "vitest";

import { readBoundedResponseBytes } from "./media.js";

describe("readBoundedResponseBytes", () => {
  it("enforces the limit when the response has no readable body", async () => {
    const arrayBuffer = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5]).buffer);
    const response = {
      headers: new Headers(),
      body: null,
      arrayBuffer,
    } as unknown as Response;

    await expect(readBoundedResponseBytes(response, 4)).rejects.toThrow(
      "Remote artifact exceeds 4 bytes.",
    );
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });
});
