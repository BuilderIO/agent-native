import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const utilSource = readFileSync(
  new URL("../../src-tauri/src/util.rs", import.meta.url),
  "utf8",
);

describe("desktop popover window chrome", () => {
  it("keeps the HTML-painted popover free of a second native frame", () => {
    const start = utilSource.indexOf("pub fn build_popover_window");
    const end = utilSource.indexOf(".on_new_window", start);
    const popoverBuilder = utilSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(popoverBuilder).toContain(".decorations(false)");
    expect(popoverBuilder).not.toContain(".decorations(true)");
  });
});
