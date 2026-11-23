import { describe, expect, it } from "vitest";

import config, { lateDiscoveredOptimizeDeps } from "./vite.config";

describe("analytics-2 dev optimizer", () => {
  it("pre-bundles the lazily loaded editor and chart dependencies", async () => {
    const resolved =
      typeof config === "function"
        ? await config({ command: "serve", mode: "development" })
        : config;
    expect(resolved.optimizeDeps?.include).toEqual(
      expect.arrayContaining([
        "@uiw/react-codemirror",
        "@codemirror/lang-sql",
        "apache-arrow",
        "vega-embed",
      ]),
    );
    expect(resolved.optimizeDeps?.include).toEqual(
      expect.arrayContaining(lateDiscoveredOptimizeDeps),
    );
  });
});
