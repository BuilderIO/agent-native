import { describe, expect, it } from "vitest";

import { contextStudioEntryAvailable } from "@/components/shell/contextStudioEntry";
import { resolveRoutePage } from "@/components/workspace/pages";
import {
  isUnavailableAnalyticsRoute,
  resolveRoute,
} from "@/routes/routing/registry";

describe("context studio availability", () => {
  it("resolves Setup and Connections pages", () => {
    for (const path of [
      "/context-studio/setup",
      "/context-studio/connections",
    ]) {
      const route = resolveRoute(path);
      expect(isUnavailableAnalyticsRoute(route)).toBe(false);
      expect(resolveRoutePage(route)).toBeDefined();
    }
  });

  it.each([
    "overview",
    "suggestions",
    "evals",
    "evals/compare",
    "evals/runs/example",
    "evals/suites/example",
    "endorsements",
    "guides",
    "models/example/schema",
    "repositories",
    "knowledge",
    "apps",
    "workbench",
  ])("marks the unbacked /context-studio/%s route unavailable", (view) => {
    const route = resolveRoute(`/context-studio/${view}`);
    expect(route.frame).toBe("context-studio");
    expect(isUnavailableAnalyticsRoute(route)).toBe(true);
  });

  it("offers the More entry, because the page it links to renders", () => {
    expect(contextStudioEntryAvailable()).toBe(true);
  });
});
