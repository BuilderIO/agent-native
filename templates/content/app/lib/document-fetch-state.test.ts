import { describe, expect, it } from "vitest";

import { documentFetchView } from "./document-fetch-state";

describe("documentFetchView", () => {
  it("removes previously visible content after an authoritative denial", () => {
    expect(
      documentFetchView({
        hasData: true,
        isFetching: false,
        isError: true,
        status: 403,
      }),
    ).toBe("unavailable");
  });

  it("keeps admitted content visible during an ordinary refresh", () => {
    expect(
      documentFetchView({
        hasData: true,
        isFetching: true,
        isError: false,
      }),
    ).toBe("ready");
  });
});
