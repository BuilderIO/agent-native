import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BRIDGE = readFileSync(
  path.join(__dirname, "editor-chrome.bridge.ts"),
  "utf8",
);

describe("editor-chrome bridge element previews", () => {
  it("pairs every textContent/innerHTML cap with a flag at the same limit", () => {
    const caps = [
      ...BRIDGE.matchAll(/el\.(textContent|innerHTML)\.slice\(0,\s*(\d+)\)/g),
    ].map(([, field, limit]) => `${field}:${limit}`);

    const flags = [
      ...BRIDGE.matchAll(/el\.(textContent|innerHTML)\.length > (\d+)/g),
    ].map(([, field, limit]) => `${field}:${limit}`);

    expect(caps.length).toBeGreaterThan(0);
    for (const cap of new Set(caps)) {
      expect(flags, `capped ${cap} with no matching truncation flag`).toContain(
        cap,
      );
    }
  });
});
