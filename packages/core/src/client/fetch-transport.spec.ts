import { describe, expect, it } from "vitest";

import {
  _bearerTokensHeldForTests,
  bearerTransport,
} from "./fetch-transport.js";

describe("bearer transports", () => {
  it("keeps only the token requests carry now, and gives a returning token a new transport", () => {
    const first = bearerTransport("token-a");
    expect(bearerTransport("token-a")).toBe(first);

    const rotated = bearerTransport("token-b");
    expect(rotated).not.toBe(first);
    expect(_bearerTokensHeldForTests()).toEqual(["token-b"]);

    // The old token back: requests carry other credentials than a moment ago.
    expect(bearerTransport("token-a")).not.toBe(first);
    expect(_bearerTokensHeldForTests()).toEqual(["token-a"]);
  });
});
