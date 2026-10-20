import { describe, expect, it } from "vitest";

import { mseVideoSourceIdentity } from "./use-mse-video-source";

describe("mseVideoSourceIdentity", () => {
  it("ignores rotating access passes while preserving the media version", () => {
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=old&media=7")).toBe(
      mseVideoSourceIdentity("/api/video/rec_1?t=new&media=7"),
    );
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=new&media=8")).not.toBe(
      mseVideoSourceIdentity("/api/video/rec_1?t=new&media=7"),
    );
  });

  it("keeps a different recording as a different source", () => {
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=old")).not.toBe(
      mseVideoSourceIdentity("/api/video/rec_2?t=new"),
    );
  });
});
