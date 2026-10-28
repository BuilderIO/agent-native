// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { fingerprintMedia, readBoundedResponseBytes } from "./media.js";

vi.mock("node:crypto", () => {
  throw new Error("Media fingerprinting must not import node:crypto.");
});

describe("fingerprintMedia", () => {
  it("returns the SHA-256 digest, byte length, and optional MIME type", () => {
    expect(window).toBeDefined();
    expect(
      fingerprintMedia(new TextEncoder().encode("abc"), "image/png"),
    ).toEqual({
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      byteLength: 3,
      mimeType: "image/png",
    });
  });
});

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
