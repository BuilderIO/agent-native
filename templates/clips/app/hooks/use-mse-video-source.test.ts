import { describe, expect, it } from "vitest";

import { mseVideoSourceIdentity } from "./use-mse-video-source";

describe("mseVideoSourceIdentity", () => {
  it("keeps a different recording as a different source", () => {
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=old")).not.toBe(
      mseVideoSourceIdentity("/api/video/rec_2?t=new"),
    );
  });

  it("ignores the access pass and password so a refreshed pass is the same source", () => {
    const base = mseVideoSourceIdentity("/api/video/rec_1?media=7");
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=old&media=7")).toBe(base);
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=new&media=7")).toBe(base);
    expect(
      mseVideoSourceIdentity("/api/video/rec_1?media=7&password=hunter2&t=x"),
    ).toBe(base);
    expect(
      mseVideoSourceIdentity(
        "/api/video/rec_1?media=7&X-Amz-Signature=abc&X-Amz-Expires=60",
      ),
    ).toBe(base);
  });

  it("treats a changed media version as a new source", () => {
    expect(mseVideoSourceIdentity("/api/video/rec_1?t=a&media=7")).not.toBe(
      mseVideoSourceIdentity("/api/video/rec_1?t=a&media=8"),
    );
  });
});
