import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { documentContentHash } from "./document-content-hash";

describe("documentContentHash", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["", "Plain words", "Café — naïve 🌱\r\nnext line"])(
    "names %j the way the server's contentHash does",
    async (content) => {
      expect(await documentContentHash(content)).toBe(
        `sha256:${createHash("sha256").update(content).digest("hex")}`,
      );
    },
  );

  it("returns null where the browser has no digest to name the body with", async () => {
    vi.stubGlobal("crypto", {});
    expect(await documentContentHash("Plain words")).toBeNull();
  });
});
