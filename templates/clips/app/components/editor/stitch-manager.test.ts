import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(): string {
  return readFileSync(new URL("./stitch-manager.tsx", import.meta.url), "utf8");
}

describe("StitchManager layout", () => {
  it("loads playable media fields for the stitch queue", () => {
    const source = readSource();

    expect(source).toContain(
      'useActionQuery("list-recordings", {\n    includeMedia: true,\n  })',
    );
  });

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

  it("checks storage before running client-side concat or creating a row", () => {
    const source = readSource();
    const storageCheckIndex = source.indexOf("await storageStatus.refetch()");
    const exportIndex = source.indexOf("await exportConcat(");
    const createIndex = source.indexOf("await stitch.mutateAsync(");

    expect(storageCheckIndex).toBeGreaterThan(-1);
    expect(storageCheckIndex).toBeLessThan(exportIndex);
    expect(storageCheckIndex).toBeLessThan(createIndex);
    expect(source).toContain("<FileStorageSetupDialog");
  });
});
