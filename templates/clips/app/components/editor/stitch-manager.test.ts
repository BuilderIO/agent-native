import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(): string {
  return readFileSync(new URL("./stitch-manager.tsx", import.meta.url), "utf8");
}

describe("StitchManager layout", () => {
  it("keeps long recording lists scrollable without pushing the footer away", () => {
    const source = readSource();

    expect(source).toMatch(
      /DialogContent className="flex max-h-\[min\(760px,calc\(100vh-32px\)\)\] max-w-3xl flex-col gap-0"/,
    );
    expect(source).toContain(
      'className="grid min-h-[320px] flex-1 grid-cols-2 gap-3"',
    );
    expect(source).toContain('className="min-h-0 flex-1"');
    expect(source).toContain('<DialogFooter className="shrink-0 pt-4">');
  });
});
