import { describe, expect, it } from "vitest";

import { findInteractLinkTarget } from "./screen-command-utils";
import type { DesignFile } from "./types";

const file = (id: string, filename: string): DesignFile => ({
  id,
  filename,
  fileType: "html",
  content: "",
  createdAt: "",
  updatedAt: "",
});

const FILES = [
  file("f-home", "index.html"),
  file("f-pricing", "pricing.html"),
  file("f-docs", "Docs.html"),
];

describe("findInteractLinkTarget", () => {
  it("finds the screen a prototype link names, however the link spells it", () => {
    for (const screen of [
      "pricing",
      "pricing.html",
      "./pricing.html",
      "/pricing",
      "Pricing",
    ]) {
      expect(findInteractLinkTarget(FILES, screen, "f-home")?.id).toBe(
        "f-pricing",
      );
    }
    expect(findInteractLinkTarget(FILES, "docs", "f-home")?.id).toBe("f-docs");
  });

  it("finds nothing for a link that names no screen of the design", () => {
    expect(findInteractLinkTarget(FILES, "checkout", "f-home")).toBeNull();
    expect(findInteractLinkTarget(FILES, "", "f-home")).toBeNull();
    expect(findInteractLinkTarget(FILES, "   ", "f-home")).toBeNull();
  });

  it("finds nothing for a link to the screen already showing", () => {
    expect(findInteractLinkTarget(FILES, "pricing", "f-pricing")).toBeNull();
  });

  it("still finds a screen when none is showing", () => {
    expect(findInteractLinkTarget(FILES, "pricing", null)?.id).toBe(
      "f-pricing",
    );
  });
});
