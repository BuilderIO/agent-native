import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryAuditView.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactoryAuditView outcome-first audit", () => {
  it("renders run headlines from investigated outcomes instead of raw event checks", () => {
    const source = readViewSource();
    expect(source).toContain("formatRunHeadline(run.counts, t)");
    expect(source).toContain("run.items");
    expect(source).toContain('t("factoryRoute.auditTrace")');
    expect(source).not.toContain("formatAuditCountLabel");
    expect(source).not.toContain("Slack thread");
  });
});
