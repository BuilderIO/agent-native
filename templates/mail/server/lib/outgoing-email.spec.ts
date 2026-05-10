import { describe, expect, it } from "vitest";
import {
  encodeAddressHeader,
  encodeMimeHeaderValue,
} from "./outgoing-email.js";

describe("encodeMimeHeaderValue", () => {
  it("leaves pure-ASCII headers unchanged", () => {
    expect(encodeMimeHeaderValue("Just plain ASCII text")).toBe(
      "Just plain ASCII text",
    );
  });

  it("RFC 2047 base64-encodes em-dash subjects so they don't arrive as mojibake", () => {
    const subject = "Offsite — What Are You Most Looking Forward To?";
    const encoded = encodeMimeHeaderValue(subject);
    expect(encoded).toBe(
      "=?UTF-8?B?T2Zmc2l0ZSDigJQgV2hhdCBBcmUgWW91IE1vc3QgTG9va2luZyBGb3J3YXJkIFRvPw==?=",
    );
    const m = encoded.match(/^=\?UTF-8\?B\?(.+)\?=$/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe(subject);
  });

  it("encodes accented characters and smart quotes", () => {
    expect(encodeMimeHeaderValue("Café — “quoted”")).toMatch(
      /^=\?UTF-8\?B\?.+\?=$/,
    );
  });
});

describe("encodeAddressHeader", () => {
  it("leaves bare ASCII emails unchanged", () => {
    expect(encodeAddressHeader("alice@example.com")).toBe("alice@example.com");
  });

  it("leaves ASCII display names unchanged", () => {
    expect(encodeAddressHeader("Alice <alice@example.com>")).toBe(
      "Alice <alice@example.com>",
    );
  });

  it("encodes only the display-name portion when it contains non-ASCII", () => {
    const result = encodeAddressHeader("Étienne <e@example.com>");
    expect(result).toBe("=?UTF-8?B?w4l0aWVubmU=?= <e@example.com>");
  });

  it("handles a list of addresses", () => {
    const result = encodeAddressHeader("Alice <a@x.com>, Bob <b@y.com>");
    expect(result).toBe("Alice <a@x.com>, Bob <b@y.com>");
  });
});
