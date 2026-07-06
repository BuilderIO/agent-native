import { describe, expect, it } from "vitest";

import { decodeFig, decodeKiwiContainer } from "./decode.js";

describe("figma decode guards", () => {
  it("rejects non-Figma bytes", () => {
    expect(() => decodeFig(Buffer.from("plain html"))).toThrow(/fig-kiwi/i);
  });

  it("rejects truncated fig-kiwi headers", () => {
    expect(() => decodeKiwiContainer(Buffer.from("fig-kiwi"))).toThrow(
      /truncated/i,
    );
  });

  it("rejects truncated chunk payloads", () => {
    const file = Buffer.alloc(16);
    file.write("fig-kiwi", 0, "utf8");
    file.writeUInt32LE(1, 8);
    file.writeUInt32LE(128, 12);

    expect(() => decodeKiwiContainer(file)).toThrow(/past end/i);
  });
});
