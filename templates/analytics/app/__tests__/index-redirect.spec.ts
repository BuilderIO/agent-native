import { describe, expect, it } from "vitest";

import { clientLoader, loader } from "../routes/_index";

function locationFromLoader(fn: typeof loader, url: string): string {
  try {
    fn({
      request: new Request(url),
      url: new URL(url),
      pattern: "/",
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

describe("index redirect", () => {
  it("redirects the root route to Ask", () => {
    expect(locationFromLoader(loader, "https://x.test/")).toBe("/ask");
  });

  it("preserves query strings and hashes", () => {
    expect(
      locationFromLoader(loader, "https://x.test/?from=workspace#question"),
    ).toBe("/ask?from=workspace#question");
  });

  it("uses the same redirect on the client loader", () => {
    expect(locationFromLoader(clientLoader, "https://x.test/?foo=bar")).toBe(
      "/ask?foo=bar",
    );
  });
});
