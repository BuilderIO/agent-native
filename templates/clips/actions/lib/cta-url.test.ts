import { describe, expect, it } from "vitest";

import { ctaUrlSchema } from "./cta-url";

describe("ctaUrlSchema", () => {
  it("accepts public web links", () => {
    expect(ctaUrlSchema.safeParse("https://example.com/start").success).toBe(
      true,
    );
    expect(ctaUrlSchema.safeParse("http://example.test").success).toBe(true);
  });

  it("rejects non-web and executable links", () => {
    expect(ctaUrlSchema.safeParse("").success).toBe(false);
    expect(ctaUrlSchema.safeParse("not a url").success).toBe(false);
    expect(ctaUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(ctaUrlSchema.safeParse("mailto:test@example.com").success).toBe(
      false,
    );
  });
});
