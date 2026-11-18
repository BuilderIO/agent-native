import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server/ssr-handler", () => ({
  createH3SSRHandler: () => vi.fn(),
  resolveSsrCacheHeaders: () => ({}),
  resolveSsrCacheKeyHeaders: () => ({}),
}));

import pageGet from "../server/routes/[...page].get";
import pageHead from "../server/routes/[...page].head";
import indexGet from "../server/routes/index.get";
import indexHead from "../server/routes/index.head";

// Nitro compiles [...page] to the named wildcard /**:page, which never
// matches "/", so the home page needs its own index route per method.
describe("docs root route", () => {
  it("serves / through the same SSR handlers as the catch-all", () => {
    expect(indexGet).toBe(pageGet);
    expect(indexHead).toBe(pageHead);
  });
});
