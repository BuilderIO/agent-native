import { describe, expect, it } from "vitest";

import { isPublicDesignAppPath } from "./public-routes";

describe("isPublicDesignAppPath", () => {
  it.each([
    "/visual-edit",
    "/design",
    "/design/public-design-id",
    "/present/public-design-id",
  ])("allows anonymous access to %s", (pathname) => {
    expect(isPublicDesignAppPath(pathname)).toBe(true);
  });

  it.each(["/", "/templates", "/settings", "/design-systems"])(
    "keeps %s behind the session gate",
    (pathname) => {
      expect(isPublicDesignAppPath(pathname)).toBe(false);
    },
  );
});
