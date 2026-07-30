import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);

describe("SlideEditor layout overflow warning", () => {
  it("stays readable over arbitrary slide backgrounds", () => {
    expect(source).toContain("border-amber-400/70");
    expect(source).toContain("bg-amber-950/95");
    expect(source).toContain("text-amber-50");
  });

  it("can be dismissed until the slide content changes", () => {
    expect(source).toContain("!isOverflowWarningDismissed");
    expect(source).toContain("setIsOverflowWarningDismissed(false)");
    expect(source).toContain('aria-label="Dismiss layout warning"');
  });
});
