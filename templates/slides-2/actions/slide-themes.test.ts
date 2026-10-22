import { describe, expect, it } from "vitest";

import getTheme from "./get-slide-theme.js";
import listThemes from "./list-slide-themes.js";

describe("built-in slide themes", () => {
  it("lists compact authoring metadata separately from deck templates", async () => {
    const result = await listThemes.run(listThemes.schema.parse({}));

    expect(result).toMatchObject({
      count: 3,
      themes: [
        { id: "aero", name: "Aero", mode: "dark" },
        { id: "fieldwork", name: "Fieldwork", mode: "light" },
        { id: "pommi", name: "Pommi", mode: "light" },
      ],
    });
    expect(result.themes.every((theme) => !("guide" in theme))).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
    expect(listThemes.readOnly).toBe(true);
    expect(listThemes.http?.method).toBe("GET");
  });

  it("returns the complete selected guide for agent authoring", async () => {
    const theme = await getTheme.run({ id: "aero" });

    expect(theme).toMatchObject({ id: "aero", name: "Aero", mode: "dark" });
    expect(theme.guide).toContain("Slides 2 runtime and persistence notes");
    expect(theme.guide).toContain('export const meta = { theme: "aero" };');
    expect(theme.guide).toContain("capped at 320");
    expect(theme.guide).toContain("Google Fonts URLs");
    expect(theme.guide).toContain("heroScale` and `bodyScale` are multipliers");
    expect(theme.guide).toContain("# Aero");
    expect(theme.guide).toContain("## Palette");
    expect(theme.guide.length).toBeGreaterThan(20_000);
    expect(getTheme.readOnly).toBe(true);
    expect(getTheme.http?.method).toBe("GET");
  });

  it("fails explicitly for an unknown theme", async () => {
    await expect(getTheme.run({ id: "missing" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "slide_theme_not_found",
    });
  });
});
