import { describe, expect, it } from "vitest";
import { appendSignatureToBody } from "./signature";

describe("appendSignatureToBody", () => {
  it("appends a configured signature to a new draft", () => {
    expect(appendSignatureToBody("Hi Alice", "Best,\nSteve")).toBe(
      "Hi Alice\n\nBest,\nSteve",
    );
  });

  it("does not duplicate an existing signature", () => {
    expect(
      appendSignatureToBody("Hi Alice\n\nBest,\nSteve", "Best,\nSteve"),
    ).toBe("Hi Alice\n\nBest,\nSteve");
  });

  it("places a signature before quoted reply content", () => {
    expect(
      appendSignatureToBody(
        "\n\n— On 5/6/2026, Alice wrote:\n> Hello",
        "Best,\nSteve",
      ),
    ).toBe("Best,\nSteve\n\n— On 5/6/2026, Alice wrote:\n> Hello");
  });

  it("leaves body unchanged when signature is blank", () => {
    expect(appendSignatureToBody("Hi Alice", "   ")).toBe("Hi Alice");
  });
});
