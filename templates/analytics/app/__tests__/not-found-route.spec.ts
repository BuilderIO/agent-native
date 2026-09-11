import { describe, expect, it } from "vitest";

import { loader } from "../routes/$";

// The flat-routes splat (`$.tsx`) matches every unmatched path, so React
// Router's "no routes matched" 404 branch never fires for it. Without a
// loader that sets an explicit status, the response defaults to 200 even
// though the page renders the NotFound UI — and `ssr-handler.ts` treats any
// status-200 HTML response as a real public page eligible for a year of
// durable CDN caching (see `applyDefaultSsrCacheHeader`). The loader must
// report 404 so the shell is cached as the not-found page it actually is,
// not as a real page that happens to return 200.

describe("catch-all not-found route", () => {
  it("reports HTTP 404 for an unmatched path", () => {
    const result = loader();
    expect(result).toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 404 },
    });
  });
});
