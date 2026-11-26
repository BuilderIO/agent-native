import { mockEvent } from "h3";
import { describe, expect, it } from "vitest";

import { getClientIp } from "./client-ip.js";

function eventWith(headers: Record<string, string>) {
  return mockEvent(new Request("https://app.example.test/", { headers }));
}

describe("getClientIp", () => {
  it("prefers the edge connection header over every other source", () => {
    expect(
      getClientIp(
        eventWith({
          "x-nf-client-connection-ip": " 203.0.113.1 ",
          "cf-connecting-ip": "203.0.113.2",
          "true-client-ip": "203.0.113.3",
          "x-real-ip": "203.0.113.4",
          "x-forwarded-for": "203.0.113.5",
        }),
      ),
    ).toBe("203.0.113.1");
  });

  it("falls through the edge headers in order", () => {
    expect(
      getClientIp(
        eventWith({
          "cf-connecting-ip": "203.0.113.2",
          "true-client-ip": "203.0.113.3",
          "x-real-ip": "203.0.113.4",
        }),
      ),
    ).toBe("203.0.113.2");
    expect(
      getClientIp(
        eventWith({
          "true-client-ip": "203.0.113.3",
          "x-real-ip": "203.0.113.4",
        }),
      ),
    ).toBe("203.0.113.3");
    expect(getClientIp(eventWith({ "x-real-ip": "203.0.113.4" }))).toBe(
      "203.0.113.4",
    );
  });

  it("skips a blank edge header and uses the first forwarded hop", () => {
    expect(
      getClientIp(
        eventWith({
          "x-real-ip": "   ",
          "x-forwarded-for": " 198.51.100.7 , 10.0.0.1",
        }),
      ),
    ).toBe("198.51.100.7");
  });

  it("returns undefined when no header names a client and there is no peer", () => {
    expect(getClientIp(eventWith({}))).toBeUndefined();
    expect(
      getClientIp(eventWith({ "x-forwarded-for": " , 10.0.0.1" })),
    ).toBeUndefined();
  });
});
