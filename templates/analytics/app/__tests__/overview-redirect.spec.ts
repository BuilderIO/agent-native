import { describe, expect, it } from "vitest";

import { clientLoader, loader } from "../routes/overview";

function locationFromLoader(fn: typeof loader, url: string): string {
  try {
    fn({
      request: new Request(url),
      url: new URL(url),
      pattern: "/overview",
      params: {},
      context: {} as never,
    });
  } catch (thrown) {
    if (thrown instanceof Response) {
      return thrown.headers.get("Location") ?? "";
    }
    throw thrown;
  }
  throw new Error("expected the loader to throw a redirect Response");
}

describe("overview legacy redirect", () => {
  it("redirects /overview to Ask", () => {
    expect(locationFromLoader(loader, "https://x.test/overview")).toBe("/ask");
  });

  it("preserves query strings and hashes", () => {
    expect(
      locationFromLoader(
        loader,
        "https://x.test/overview?from=sidebar#question",
      ),
    ).toBe("/ask?from=sidebar#question");
  });

  it("uses the same redirect on the client loader", () => {
    expect(
      locationFromLoader(clientLoader, "https://x.test/overview?foo=bar"),
    ).toBe("/ask?foo=bar");
  });
});
