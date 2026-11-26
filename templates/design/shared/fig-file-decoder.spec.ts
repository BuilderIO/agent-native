import * as zlib from "node:zlib";

import {
  ByteBuffer,
  compileSchema,
  encodeBinarySchema,
  parseSchema,
  type Schema,
} from "kiwi-schema";
import { describe, expect, it } from "vitest";

import { decodeFig, decodeFigImages } from "./fig-file-decoder.js";

function kiwiContainer(chunks: Uint8Array[]): Buffer {
  const header = Buffer.alloc(12);
  header.write("fig-kiwi", 0, "utf8");
  header.writeUInt32LE(124, 8);
  return Buffer.concat([
    header,
    ...chunks.flatMap((chunk) => {
      const compressed = zlib.deflateRawSync(chunk);
      const length = Buffer.alloc(4);
      length.writeUInt32LE(compressed.length);
      return [length, compressed];
    }),
  ]);
}

function figFor(
  schema: Schema,
  document: Uint8Array,
  blobs: Uint8Array[] = [],
) {
  return kiwiContainer([encodeBinarySchema(schema), document, ...blobs]);
}

describe("budgeted kiwi decoding", () => {
  it("decodes strings exactly like kiwi, including a BOM and malformed UTF-8", () => {
    const bom = String.fromCharCode(0xfeff);
    const schema = parseSchema("message Message { string[] values = 1; }");
    const document = new ByteBuffer();
    document.writeVarUint(1);
    document.writeVarUint(5);
    document.writeString(`${bom}lead`);
    document.writeString("café \u{1F600}");
    for (const byte of [0x61, 0xc0, 0x80, 0x62, 0x00, 0x80, 0x00]) {
      document.writeByte(byte);
    }
    document.writeVarUint(0);
    const bytes = document.toUint8Array();
    const reference = (
      compileSchema(schema) as { decodeMessage(data: Uint8Array): unknown }
    ).decodeMessage(bytes);

    expect(decodeFig(figFor(schema, bytes)).document).toEqual(reference);
    expect(reference).toEqual({
      values: [`${bom}lead`, "café \u{1F600}", "a", "b", "\u0080"],
    });
  });

  it("keeps binary fields as bytes and 64-bit integers as strings", () => {
    const schema = parseSchema(
      "message Message { byte[] hash = 1; uint64 big = 2; int64 negative = 3; }",
    );
    const compiled = compileSchema(schema) as {
      encodeMessage(value: unknown): Uint8Array;
    };
    const document = compiled.encodeMessage({
      hash: new Uint8Array([1, 2, 255]),
      big: 18_446_744_073_709_551_615n,
      negative: -5n,
    });

    expect(decodeFig(figFor(schema, document)).document).toEqual({
      hash: new Uint8Array([1, 2, 255]),
      big: "18446744073709551615",
      negative: "-5",
    });
  });

  it.each(["Kind", "Kind$"])(
    "counts enum names against the decoded string budget (enum %s)",
    (enumName) => {
      const name = `V${"x".repeat(999)}`;
      const schema = parseSchema(
        `enum Kind { ${name} = 0; } message Message { Kind[] kinds = 1; }`,
      );
      const compiled = compileSchema(schema) as {
        encodeMessage(value: unknown): Uint8Array;
      };
      const document = compiled.encodeMessage({
        kinds: new Array(40_000).fill(name),
      });
      schema.definitions[0]!.name = enumName;
      schema.definitions[1]!.fields[0]!.type = enumName;

      const decoded = decodeFig(figFor(schema, document));
      expect(decoded.document).toBeNull();
      expect(decoded.decodeError).toMatch(/too much string data/i);
    },
  );

  it.each([true, false])(
    "charges rescanned string spans to the decode work budget (terminated: %s)",
    (terminated) => {
      const schema = parseSchema("message Message { string[] values = 1; }");
      const count = 64 * 1024;
      const document = new ByteBuffer();
      document.writeVarUint(1);
      document.writeVarUint(count);
      for (let index = 0; index < count; index += 1) {
        document.writeByte(0xc0);
        document.writeByte(0x80);
      }
      if (terminated) {
        document.writeByte(0x00);
        document.writeVarUint(0);
      }

      const decoded = decodeFig(figFor(schema, document.toUint8Array()));
      expect(decoded.decodeError).toMatch(/decode work budget/i);
    },
  );

  it("rejects an oversized byte array from its declared length", () => {
    const schema = parseSchema("message Message { byte[] hash = 1; }");
    const compiled = compileSchema(schema) as {
      encodeMessage(value: unknown): Uint8Array;
    };
    const document = compiled.encodeMessage({
      hash: new Uint8Array(4 * 1024 * 1024 + 1),
    });

    expect(decodeFig(figFor(schema, document)).decodeError).toMatch(
      /too much binary data/i,
    );
  });

  it("rejects a single string above the per-string budget", () => {
    const schema = parseSchema("message Message { string value = 1; }");
    const compiled = compileSchema(schema) as {
      encodeMessage(value: unknown): Uint8Array;
    };
    const document = compiled.encodeMessage({
      value: "a".repeat(4 * 1024 * 1024 + 1),
    });

    expect(decodeFig(figFor(schema, document)).decodeError).toMatch(
      /too much string data/i,
    );
  });

  it("counts arrays as a nesting level", () => {
    const schema = parseSchema(
      "message Link { Link[] children = 1; } message Message { Link root = 1; }",
    );
    const document = new ByteBuffer();
    document.writeVarUint(1);
    for (let index = 0; index < 200; index += 1) {
      document.writeVarUint(1);
      document.writeVarUint(1);
    }
    document.writeVarUint(0);
    for (let index = 0; index < 200; index += 1) document.writeVarUint(0);
    document.writeVarUint(0);

    expect(
      decodeFig(figFor(schema, document.toUint8Array())).decodeError,
    ).toMatch(/nested too deeply/i);
  });

  it("rejects __proto__ identifiers instead of decoding into a prototype", () => {
    const schema = parseSchema(
      "message Inner { string polluted = 1; } message Message { Inner field = 1; }",
    );
    schema.definitions[1]!.fields[0]!.name = "__proto__";
    const compiled = compileSchema(
      parseSchema(
        "message Inner { string polluted = 1; } message Message { Inner field = 1; }",
      ),
    ) as { encodeMessage(value: unknown): Uint8Array };
    const document = compiled.encodeMessage({ field: { polluted: "yes" } });

    const decoded = decodeFig(figFor(schema, document));
    expect(decoded.document).toBeNull();
    expect(decoded.decodeError).toMatch(/unsafe field identifier/i);
  });
});

describe("decodeFigImages", () => {
  it("returns the same embedded images as a full decode", () => {
    const schema = parseSchema("message Message { string hello = 1; }");
    const compiled = compileSchema(schema) as {
      encodeMessage(value: unknown): Uint8Array;
    };
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    const fig = figFor(schema, compiled.encodeMessage({ hello: "world" }), [
      png,
      png,
      new Uint8Array([9, 9, 9]),
    ]);

    const images = decodeFigImages(fig);
    expect(images).toEqual(decodeFig(fig).images);
    expect(images).toHaveLength(1);
    expect(images[0]!.ext).toBe("png");
  });
});
