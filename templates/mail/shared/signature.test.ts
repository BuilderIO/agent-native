import { describe, expect, it } from "vitest";
import { appendSignatureToBody, normalizeSignature } from "./signature";

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

  it("strips image markdown from signatures before appending", () => {
    const signature = "Steve\n![Logo](https://example.com/logo.png)";
    expect(normalizeSignature(signature)).toBe("Steve");
    expect(appendSignatureToBody("Hi Alice", signature)).toBe(
      "Hi Alice\n\nSteve",
    );
  });

  it("strips images whose alt text contains brackets", () => {
    const signature = "Steve\n![Image [1]](https://example.com/logo.png)";
    expect(normalizeSignature(signature)).toBe("Steve");
  });

  it("strips linked-image logos without leaving an empty link", () => {
    const signature =
      "Steve\n[![Logo](https://example.com/logo.png)](https://example.com)";
    expect(normalizeSignature(signature)).toBe("Steve");
  });
});
