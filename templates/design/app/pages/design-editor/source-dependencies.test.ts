import { describe, expect, it } from "vitest";

import { inlineDesignStylesheets } from "@/components/design/design-canvas/linked-stylesheets";

import { sourceDependencyIds } from "./source-dependencies";
import type { SourceHydrationState } from "./source-hydration";

describe("source dependencies", () => {
  it("hydrates referenced styles and recursive modules without an unrelated screen", () => {
    const files = [
      { id: "screen", filename: "index.html" },
      { id: "style", filename: "styles.css" },
      { id: "script", filename: "app.js" },
      { id: "component", filename: "components/Card.jsx" },
      { id: "other", filename: "other.html" },
    ];
    const bodies = new Map<string, string>([
      [
        "screen",
        '<link rel="stylesheet" href="styles.css"><script src="app.js"></script>',
      ],
      ["style", ".card { color: red }"],
      ["script", 'import Card from "./components/Card.jsx"'],
      ["component", "export default function Card() {}"],
    ]);
    const loaded = new Set(["screen"]);
    const reads: string[] = [];
    const get = (id: string): SourceHydrationState =>
      loaded.has(id)
        ? { status: "ready", content: bodies.get(id) ?? "", updatedAt: "1" }
        : { status: "unloaded" };
    for (let i = 0; i < 3; i++) {
      for (const id of sourceDependencyIds(files, ["screen"], get).ids) {
        if (!loaded.has(id)) {
          reads.push(id);
          loaded.add(id);
        }
      }
    }
    expect(reads).toEqual(["style", "script", "component"]);
    expect(
      inlineDesignStylesheets(
        bodies.get("screen") ?? "",
        new Map([["styles.css", bodies.get("style") ?? ""]]),
      ),
    ).toContain(".card { color: red }");
    expect(reads).not.toContain("other");
  });
  it("reports dependency overflow instead of loading an unbounded graph", () => {
    const files = [
      { id: "root", filename: "index.html" },
      ...Array.from({ length: 130 }, (_, i) => ({
        id: `f${i}`,
        filename: `f${i}.css`,
      })),
    ];
    const html = files
      .slice(1)
      .map((file) => `<link href="${file.filename}">`)
      .join("");
    const result = sourceDependencyIds(files, ["root"], (id) =>
      id === "root"
        ? { status: "ready", content: html, updatedAt: "1" }
        : { status: "unloaded" },
    );
    expect(result.overflow).toBe(true);
    expect(result.ids).toHaveLength(128);
  });
  it("reports a failed referenced source instead of treating the preview as complete", () => {
    const files = [
      { id: "root", filename: "index.html" },
      { id: "css", filename: "theme.css" },
    ];
    const result = sourceDependencyIds(files, ["root"], (id) =>
      id === "root"
        ? {
            status: "ready",
            content: '<link rel="stylesheet" href="theme.css">',
            updatedAt: "1",
          }
        : { status: "error", error: new Error("offline") },
    );
    expect(result.failed).toBe(true);
    expect(result.ids).toContain("css");
  });
});
