import { describe, expect, it } from "vitest";

import { documentTitle } from "./document-title";

// Every page names itself in the browser tab and appends the signed-in workspace's name, so two open
// tabs can be told apart and the tab never keeps the framework's placeholder ("App", "Workspace").
describe("the shared browser-tab shape", () => {
  it("names a page and the signed-in workspace", () => {
    expect(documentTitle(["Home"], "Acme")).toBe("Home - Acme");
  });

  it("names a view and a record with their own separators", () => {
    expect(documentTitle(["People", "All people"], "Acme")).toBe(
      "People | All people - Acme",
    );
    expect(documentTitle(["Northwind Traders", "Companies"], "Acme")).toBe(
      "Northwind Traders | Companies - Acme",
    );
  });

  it("shows the workspace alone on a route that has no page name", () => {
    // A route that pinned its own static title read "Settings - Workspace" forever.
    expect(documentTitle([], "Acme")).toBe("Acme");
    expect(documentTitle([null, "  "], "Acme")).toBe("Acme");
  });

  it("never prints separators around nothing", () => {
    expect(documentTitle(["Home"], null)).toBe("Home");
    expect(documentTitle(["Home"], "   ")).toBe("Home");
    expect(documentTitle([], null)).toBe("");
  });
});
