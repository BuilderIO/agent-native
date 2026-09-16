import { describe, expect, it } from "vitest";

import { privateShareLoaderData } from "./share-loader-response";

describe("privateShareLoaderData", () => {
  it("marks access-dependent share responses private and non-cacheable", () => {
    const result = privateShareLoaderData({ recording: null }) as {
      data: { recording: null };
      init: { headers: HeadersInit };
    };
    const headers = new Headers(result.init.headers);

    expect(result.data).toEqual({ recording: null });
    expect(headers.get("Cache-Control")).toBe("private, max-age=0, no-store");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("preserves an access-denied status without making the response cacheable", () => {
    const result = privateShareLoaderData({ recording: null }, 403) as {
      init: { status: number };
    };

    expect(result.init.status).toBe(403);
  });
});
