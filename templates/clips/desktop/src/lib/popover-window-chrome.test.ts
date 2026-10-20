import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const utilSource = readFileSync(
  new URL("../../src-tauri/src/util.rs", import.meta.url),
  "utf8",
);
const clipsSource = readFileSync(
  new URL("../../src-tauri/src/clips/mod.rs", import.meta.url),
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

  it("shows the camera bubble without stealing popover focus", () => {
    const start = clipsSource.indexOf("pub async fn show_bubble");
    const end = clipsSource.indexOf("pub async fn close_bubble", start);
    const bubble = clipsSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(bubble).toContain(
      "crate::util::show_without_activation(&existing);",
    );
    expect(bubble).toContain("crate::util::show_without_activation(&win);");
    expect(bubble).not.toContain("existing.show()");
    expect(bubble).not.toContain("win.show()");
  });
});
