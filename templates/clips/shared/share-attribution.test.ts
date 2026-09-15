import { describe, expect, it } from "vitest";

import {
  buildShareContinuationQuery,
  readShareAttribution,
} from "./share-attribution";

describe("buildShareContinuationQuery", () => {
  it("preserves attribution and timestamps without forwarding share secrets", () => {
    const attribution = readShareAttribution(
      "?ref=clip_share&via=owner-1&password=secret&agent_access_token=token",
    );

    expect(buildShareContinuationQuery(attribution, "90")).toBe(
      "ref=clip_share&via=owner-1&at=90",
    );
  });

  it("omits missing attribution values", () => {
    expect(
      buildShareContinuationQuery({ ref: undefined, via: undefined }),
    ).toBe("");
  });

  it("forwards the requested panel so sign-in returns to it", () => {
    const attribution = readShareAttribution("?ref=clip_share&via=owner-1");

    expect(buildShareContinuationQuery(attribution, "90", "comments")).toBe(
      "ref=clip_share&via=owner-1&at=90&panel=comments",
    );
  });

  it("omits panel when not requested", () => {
    expect(
      buildShareContinuationQuery(
        { ref: undefined, via: undefined },
        null,
        null,
      ),
    ).toBe("");
  });
});
