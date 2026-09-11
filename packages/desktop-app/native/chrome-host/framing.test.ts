import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { encodeNativeMessage, NativeMessageDecoder } from "./framing";

describe("Chrome native messaging framing", () => {
  it("decodes fragmented and adjacent length-prefixed messages", () => {
    const decoder = new NativeMessageDecoder();
    const first = encodeNativeMessage({ id: "one" });
    const second = encodeNativeMessage({ id: "two", ok: true });
    expect(decoder.push(first.subarray(0, 2))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(2), second]))).toEqual([
      { id: "one" },
      { id: "two", ok: true },
    ]);
    expect(() => decoder.finish()).not.toThrow();
  });

  it("rejects oversized inbound and outbound frames", () => {
    const decoder = new NativeMessageDecoder();
    const oversizedHeader = Buffer.alloc(4);
    oversizedHeader.writeUInt32LE(64 * 1024 * 1024 + 1);
    expect(() => decoder.push(oversizedHeader)).toThrow(/64 MB/);
    expect(() => encodeNativeMessage("x".repeat(1024 * 1024))).toThrow(/1 MB/);
  });

  it("rejects a truncated final frame", () => {
    const decoder = new NativeMessageDecoder();
    decoder.push(encodeNativeMessage({ ok: true }).subarray(0, 6));
    expect(() => decoder.finish()).toThrow(/partial frame/);
  });

  it("produces a frame Chrome can read from stdout", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    output.end(encodeNativeMessage({ id: "example", ok: true }));
    await new Promise<void>((resolve) => output.once("end", resolve));
    const frame = Buffer.concat(chunks);
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(JSON.parse(frame.subarray(4).toString("utf8"))).toEqual({
      id: "example",
      ok: true,
    });
  });
});
