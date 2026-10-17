import { describe, expect, it } from "vitest";

import {
  A2APersistencePayloadError,
  assertA2APersistablePayload,
} from "./persistence-safety.js";

describe("assertA2APersistablePayload", () => {
  it.each([
    { text: "Data: Q1 revenue" },
    { text: "encode it as base64, then retry" },
    { metadata: { bytes: "1.2 MB" } },
    { metadata: { bytes: "512 bytes" } },
  ])("allows ordinary text and non-attachment byte metadata: %o", (value) => {
    expect(() => assertA2APersistablePayload(value, "task")).not.toThrow();
  });

  it.each([
    "data:image/png;base64,iVBORw0KGgo=",
    "data:application/pdf;base64,JVBERi0=",
    "See this attachment: data:image/png;base64,iVBORw0KGgo=",
  ])("rejects data URLs anywhere in persisted payloads", (value) => {
    expect(() =>
      assertA2APersistablePayload({ metadata: { note: value } }, "task"),
    ).toThrow(A2APersistencePayloadError);
  });

  it("rejects actual bytes in a typed attachment", () => {
    expect(() =>
      assertA2APersistablePayload(
        {
          parts: [
            {
              type: "file",
              file: {
                name: "reference.png",
                bytes: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              },
            },
          ],
        },
        "task",
      ),
    ).toThrow(A2APersistencePayloadError);
  });

  it("rejects bytes in an attachment collection without a type tag", () => {
    expect(() =>
      assertA2APersistablePayload(
        { attachments: [{ name: "reference.png", bytes: "AQID" }] },
        "task",
      ),
    ).toThrow(A2APersistencePayloadError);
  });

  it("rejects a data URL or encoded body under image metadata", () => {
    expect(() =>
      assertA2APersistablePayload(
        {
          parts: [
            {
              type: "data",
              data: { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" },
            },
          ],
        },
        "task",
      ),
    ).toThrow(A2APersistencePayloadError);
  });

  it("rejects short inline data on a typed image attachment", () => {
    expect(() =>
      assertA2APersistablePayload(
        { attachments: [{ type: "image", data: "AQID" }] },
        "task",
      ),
    ).toThrow(A2APersistencePayloadError);
  });

  it("continues rejecting even an empty bytes field on a typed attachment", () => {
    expect(() =>
      assertA2APersistablePayload(
        { type: "file", file: { name: "empty.png", bytes: "" } },
        "task",
      ),
    ).toThrow(A2APersistencePayloadError);
  });
});
