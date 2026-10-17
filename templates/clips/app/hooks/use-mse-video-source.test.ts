import { describe, expect, it } from "vitest";

import { mseVideoSourceIdentity } from "./use-mse-video-source";

describe("mseVideoSourceIdentity", () => {
  it("keeps a different recording as a different source", () => {
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=old")).not.toBe(
      mseVideoSourceIdentity("/api/video/rec_2?t=new"),
    );
  });
});
