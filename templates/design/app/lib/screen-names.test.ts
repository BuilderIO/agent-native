import { describe, expect, it } from "vitest";

import { prettyScreenName } from "./screen-names";

describe("prettyScreenName", () => {
  it("names index.html and its copies after Home", () => {
    expect(prettyScreenName("index.html")).toBe("Home");
    expect(prettyScreenName("index-copy.html")).toBe("Home copy");
    expect(prettyScreenName("index-copy-2.html")).toBe("Home copy 2");
  });

  it("derives other names from the filename", () => {
    expect(prettyScreenName("page-about.html")).toBe("About");
    expect(prettyScreenName("screen-2-copy.html")).toBe("Screen 2 copy");
  });
});
