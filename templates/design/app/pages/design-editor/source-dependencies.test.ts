import { describe, expect, it } from "vitest";

import { inlineDesignStylesheets } from "@/components/design/design-canvas/linked-stylesheets";

import {
  createSourceDependencyIndex,
  scheduleSourceDependencies,
  sourceDependencyIds,
} from "./source-dependencies";
import type { SourceHydrationState } from "./source-hydration";

describe("source dependencies", () => {
  it("reuses a metadata index across root graphs", () => {
    let reads = 0;
    const files = [
      {
        id: "a",
        get filename() {
          reads++;
          return "a.html";
        },
      },
      {
        id: "b",
        get filename() {
          reads++;
          return "b.html";
        },
      },
    ];
    const index = createSourceDependencyIndex(files);
    const initialReads = reads;
    const get = (): SourceHydrationState => ({ status: "unloaded" });
    scheduleSourceDependencies(files, ["a", "b"], get, 128, index);
    sourceDependencyIds(files, ["a"], get, index);
    expect(reads).toBe(initialReads);
  });
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
  it("does not mark an unrelated root failed when shared scheduling capacity is full", () => {
    const files = [
      { id: "a", filename: "a.html" },
      { id: "a-css", filename: "a.css" },
      { id: "b", filename: "b.html" },
      { id: "b-css", filename: "b.css" },
    ];
    const states = new Map<string, SourceHydrationState>([
      [
        "a",
        { status: "ready", content: '<link href="a.css">', updatedAt: "1" },
      ],
      [
        "b",
        { status: "ready", content: '<link href="b.css">', updatedAt: "1" },
      ],
    ]);
    const result = scheduleSourceDependencies(
      files,
      ["a", "b"],
      (id) => states.get(id) ?? { status: "unloaded" },
      3,
    );
    expect(result.ids).toContain("a-css");
    expect(result.ids).not.toContain("b-css");
    expect(result.statusByRoot.get("b")).toBe("deferred");
    const reprioritized = scheduleSourceDependencies(
      files,
      ["b", "a"],
      (id) => states.get(id) ?? { status: "unloaded" },
      3,
    );
    expect(reprioritized.ids).toContain("b-css");
    expect(reprioritized.statusByRoot.get("b")).toBe("loading");
  });
  it("schedules a priority graph that fits its budget, still loading every root", () => {
    const files = [
      { id: "active", filename: "index.html" },
      { id: "one", filename: "one.css" },
      { id: "two", filename: "two.css" },
      { id: "other", filename: "other.html" },
    ];
    const get = (id: string): SourceHydrationState =>
      id === "active"
        ? {
            status: "ready",
            content: '<link href="one.css"><link href="two.css">',
            updatedAt: "1",
          }
        : { status: "unloaded" };
    const result = scheduleSourceDependencies(
      files,
      ["active", "other"],
      get,
      3,
    );
    expect(result.ids).toEqual(["active", "one", "two", "other"]);
    expect(result.statusByRoot.get("active")).toBe("loading");
    expect(result.statusByRoot.get("other")).toBe("loading");
  });
  it("does not read a preview root past the budget, but keeps a loaded one", () => {
    const files = [
      { id: "active", filename: "index.html" },
      { id: "one", filename: "one.css" },
      { id: "two", filename: "two.css" },
      { id: "other", filename: "other.html" },
      { id: "loaded", filename: "loaded.html" },
      { id: "loaded-css", filename: "loaded.css" },
    ];
    const states = new Map<string, SourceHydrationState>([
      [
        "active",
        {
          status: "ready",
          content: '<link href="one.css"><link href="two.css">',
          updatedAt: "1",
        },
      ],
      [
        "loaded",
        {
          status: "ready",
          content: '<link href="loaded.css">',
          updatedAt: "1",
        },
      ],
    ]);
    const result = scheduleSourceDependencies(
      files,
      ["active", "other", "loaded"],
      (id) => states.get(id) ?? { status: "unloaded" },
      3,
      undefined,
      { readRootsPastBudget: false },
    );
    expect(result.ids).toEqual(["active", "one", "two", "loaded"]);
    expect(result.statusByRoot.get("other")).toBe("deferred");
    expect(result.statusByRoot.get("loaded")).toBe("deferred");
    states.set("other", { status: "loading" });
    const reading = scheduleSourceDependencies(
      files,
      ["active", "other"],
      (id) => states.get(id) ?? { status: "unloaded" },
      3,
      undefined,
      { readRootsPastBudget: false },
    );
    // A read already under way keeps going and reports as such.
    expect(reading.ids).toContain("other");
    expect(reading.statusByRoot.get("other")).toBe("loading");
  });
  it("defers only the dependencies of a loaded root once the budget is full", () => {
    const files = [
      { id: "active", filename: "index.html" },
      { id: "one", filename: "one.css" },
      { id: "other", filename: "other.html" },
      { id: "theme", filename: "theme.css" },
    ];
    const content = new Map([
      ["active", '<link href="one.css">'],
      ["other", '<link href="theme.css">'],
    ]);
    const get = (id: string): SourceHydrationState => {
      const source = content.get(id);
      return source === undefined
        ? { status: "unloaded" }
        : { status: "ready", content: source, updatedAt: "1" };
    };
    const result = scheduleSourceDependencies(
      files,
      ["active", "other"],
      get,
      2,
    );
    expect(result.ids).toEqual(["active", "one", "other"]);
    expect(result.statusByRoot.get("other")).toBe("deferred");
  });
});
