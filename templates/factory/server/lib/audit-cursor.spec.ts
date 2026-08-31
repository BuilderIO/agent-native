import { describe, expect, it } from "vitest";

import {
  decodeAuditCursor,
  encodeAuditCursor,
  isAuditRunAfterCursor,
} from "./audit-cursor.js";

describe("audit cursor", () => {
  it("round-trips startedAt and id", () => {
    const encoded = encodeAuditCursor({
      startedAt: 1_700_000_000_000,
      id: "r1",
    });
    expect(decodeAuditCursor(encoded)).toEqual({
      startedAt: 1_700_000_000_000,
      id: "r1",
    });
  });

  it("rejects unreadable cursors", () => {
    expect(() => decodeAuditCursor("not-base64")).toThrow(
      "Audit cursor is unreadable.",
    );
    expect(() =>
      decodeAuditCursor(
        Buffer.from(
          JSON.stringify({ startedAt: "x", id: "r1" }),
          "utf8",
        ).toString("base64url"),
      ),
    ).toThrow("Audit cursor is unreadable.");
  });

  it("pages older runs after a DESC cursor", () => {
    const cursor = { startedAt: 100, id: "a" };
    expect(isAuditRunAfterCursor({ startedAt: 90, id: "z" }, cursor)).toBe(
      true,
    );
    expect(isAuditRunAfterCursor({ startedAt: 100, id: "b" }, cursor)).toBe(
      true,
    );
    expect(isAuditRunAfterCursor({ startedAt: 100, id: "a" }, cursor)).toBe(
      false,
    );
    expect(isAuditRunAfterCursor({ startedAt: 110, id: "z" }, cursor)).toBe(
      false,
    );
  });
});
