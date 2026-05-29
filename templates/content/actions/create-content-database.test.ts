import { describe, expect, it } from "vitest";
import { databaseTitleForPage } from "./create-content-database";

describe("create content database", () => {
  it("uses an explicit title when provided", () => {
    expect(databaseTitleForPage(" Roadmap ", "Existing page")).toBe("Roadmap");
  });

  it("falls back to the converted page title", () => {
    expect(databaseTitleForPage("", " Content calendar ")).toBe(
      "Content calendar",
    );
  });

  it("defaults untitled database pages consistently", () => {
    expect(databaseTitleForPage("", "")).toBe("Untitled database");
    expect(databaseTitleForPage()).toBe("Untitled database");
  });
});
