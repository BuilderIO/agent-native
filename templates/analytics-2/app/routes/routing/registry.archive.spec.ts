import { describe, expect, it } from "vitest";

import { hasRoutePage } from "@/components/workspace/pages";

import { resolveRoute } from "./registry";

/**
 * The sidebar links Archive at /home/archive. It resolved to the Home id with
 * the archive view, but no page was registered for it, so the frame stayed
 * empty. The projects list already renders the archive view; register it.
 */
describe("archive route", () => {
  it("resolves /home/archive to a page", () => {
    const route = resolveRoute("/home/archive");
    expect(route.view).toBe("archive");
    expect(hasRoutePage(route.id, route.view)).toBe(true);
  });
});
