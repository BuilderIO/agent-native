import { describe, it, expect } from "vitest";

import {
  isValidEmail,
  parseRecipients,
  serializeRecipients,
  extractPastedRecipients,
  computeRecipientMove,
} from "./RecipientInput";

describe("isValidEmail", () => {
  it("accepts plain addresses", () => {
    expect(isValidEmail("steve@builder.io")).toBe(true);
    expect(isValidEmail("  steve@builder.io  ")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co")).toBe(true);
  });

  it("rejects incomplete or malformed values", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("steve")).toBe(false);
    expect(isValidEmail("steve@")).toBe(false);
    expect(isValidEmail("steve@builder")).toBe(false);
    expect(isValidEmail("steve @builder.io")).toBe(false);
    expect(isValidEmail("a@b.com c@d.com")).toBe(false);
  });
});

describe("extractPastedRecipients", () => {
  it("returns null for a single token (let normal paste flow into the input)", () => {
    expect(extractPastedRecipients("steve@builder.io", [])).toBeNull();
    expect(extractPastedRecipients("not-an-email", [])).toBeNull();
    expect(extractPastedRecipients("", [])).toBeNull();
  });

  it("returns null when no token looks like an email", () => {
    expect(extractPastedRecipients("foo, bar, baz", [])).toBeNull();
  });

  it("splits comma/semicolon/newline separated addresses into chips", () => {
    expect(
      extractPastedRecipients("a@x.com, b@y.com; c@z.com\nd@w.com", []),
    ).toEqual({
      added: ["a@x.com", "b@y.com", "c@z.com", "d@w.com"],
      leftover: "",
    });
  });

  it("dedupes against existing recipients and within the paste, case-insensitively", () => {
    expect(
      extractPastedRecipients("A@x.com, b@y.com, a@x.com", ["a@x.com"]),
    ).toEqual({ added: ["b@y.com"], leftover: "" });
  });

  it("keeps non-email leftovers in the input", () => {
    expect(extractPastedRecipients("a@x.com, half-typed", [])).toEqual({
      added: ["a@x.com"],
      leftover: "half-typed",
    });
  });
});

describe("computeRecipientMove", () => {
  it("removes the token from the source and appends it to the target", () => {
    expect(
      computeRecipientMove("a@x.com, b@y.com", "c@z.com", "a@x.com"),
    ).toEqual({ from: "b@y.com", to: "c@z.com, a@x.com" });
  });

  it("moves into an empty target field", () => {
    expect(computeRecipientMove("a@x.com", "", "a@x.com")).toEqual({
      from: "",
      to: "a@x.com",
    });
  });

  it("does not duplicate when the token is already present in the target", () => {
    expect(
      computeRecipientMove("a@x.com", "A@x.com, c@z.com", "a@x.com"),
    ).toEqual({ from: "", to: "A@x.com, c@z.com" });
  });

  it("moves alias tokens like any other recipient", () => {
    expect(
      computeRecipientMove("alias:team1, a@x.com", "", "alias:team1"),
    ).toEqual({ from: "a@x.com", to: "alias:team1" });
  });
});

describe("parse/serialize round-trip", () => {
  it("parses and re-serializes a recipient list", () => {
    expect(serializeRecipients(parseRecipients("a@x.com,  b@y.com , "))).toBe(
      "a@x.com, b@y.com",
    );
  });
});
