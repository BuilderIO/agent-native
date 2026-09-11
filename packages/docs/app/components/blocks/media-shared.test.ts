import { describe, expect, it } from "vitest";

import { mediaSrcSchema } from "./media-shared";

describe("mediaSrcSchema", () => {
  it.each(["/images/foo.png", "/videos/demo.mp4", "/"])(
    "accepts an absolute local path: %s",
    (src) => {
      expect(mediaSrcSchema.safeParse(src).success).toBe(true);
    },
  );

  it.each([
    "https://cdn.example.com/foo.mp4",
    "http://cdn.example.com/foo.mp4",
  ])("accepts an http(s) URL: %s", (src) => {
    expect(mediaSrcSchema.safeParse(src).success).toBe(true);
  });

  it.each([
    "//attacker.example/media.mp4",
    "//attacker.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
  ])("rejects an unsafe or protocol-relative src: %s", (src) => {
    expect(mediaSrcSchema.safeParse(src).success).toBe(false);
  });
});
