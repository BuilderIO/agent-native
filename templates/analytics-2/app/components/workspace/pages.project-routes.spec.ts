import { describe, expect, it } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { resolveRoutePage } from "./pages";

describe("resolveRoutePage project routes", () => {
  it("resolves /project/:id/latest/ui, /split, and /debug to NotebookPage", () => {
    for (const path of [
      "/project/prj-1/latest/ui",
      "/project/prj-1/latest/split",
      "/project/prj-1/latest/debug",
    ]) {
      const route = resolveRoute(path);
      expect(resolveRoutePage(route), `missing page for ${path}`).toBeDefined();
    }
  });
});
