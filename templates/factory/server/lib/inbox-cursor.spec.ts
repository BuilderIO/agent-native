import { describe, expect, it } from "vitest";

import { decodeInboxCursor, encodeInboxCursor } from "./inbox-cursor.js";

describe("inbox cursor", () => {
  it("round-trips an item identity", () => {
    const cursor = { updatedAt: "2026-08-26T20:00:00.000Z", id: "item-1" };
    expect(decodeInboxCursor(encodeInboxCursor(cursor))).toEqual(cursor);
  });

  it("rejects truncated or coerced cursor values", () => {
    expect(() => decodeInboxCursor("not-a-cursor")).toThrow(
      "Inbox cursor is unreadable.",
    );
    expect(() =>
      decodeInboxCursor(
        Buffer.from(JSON.stringify({ updatedAt: "" }), "utf8").toString(
          "base64url",
        ),
      ),
    ).toThrow("Inbox cursor is unreadable.");
  });
});
