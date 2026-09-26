import { describe, expect, it } from "vitest";

import {
  DECK_TEMPLATE_CATEGORIES,
  getBuiltInDeckTemplate,
  listBuiltInDeckTemplates,
} from "../server/lib/deck-templates.js";
import getTemplate from "./get-deck-template.js";
import listTemplates from "./list-deck-templates.js";

describe("built-in deck templates", () => {
  it("contains six independent, complete multi-slide starters", () => {
    const templates = listBuiltInDeckTemplates();
    expect(templates.map((item) => item.category)).toEqual([
      ...DECK_TEMPLATE_CATEGORIES,
    ]);
    expect(new Set(templates.map((item) => item.id)).size).toBe(6);
    expect(templates.flatMap((item) => item.slides)).toHaveLength(28);
    for (const template of templates) {
      expect(template.slides.length).toBeGreaterThanOrEqual(4);
      expect(template).toMatchObject({
        aspectRatio: "16:9",
        width: 960,
        height: 540,
        isBuiltIn: true,
      });
      for (const slide of template.slides) {
        expect(slide.content).toContain('class="fmd-slide"');
        expect(slide.content).toContain(
          "width:960px;height:540px;box-sizing:border-box",
        );
        expect(slide.content).toContain("<h1");
        expect(slide.content).not.toMatch(
          /<script|<iframe|<img|https?:|@import|url\(|margin:0 0:0|overflow:hidden|transform:scale/i,
        );
        expect(slide.notes.length).toBeGreaterThan(20);
        expect(slide).not.toHaveProperty("html");
      }
    }
    templates[0].slides[0].content = "Edited";
    expect(getBuiltInDeckTemplate(templates[0].id)?.slides[0].content).not.toBe(
      "Edited",
    );
  });

  it("lists only bounded metadata by default", async () => {
    const result = await listTemplates.run(listTemplates.schema.parse({}));
    expect(result).toMatchObject({
      total: 6,
      page: 1,
      pageSize: 6,
      hasMore: false,
    });
    for (const item of result.templates) {
      expect(item).not.toHaveProperty("slides");
      expect(item).not.toHaveProperty("previewHtml");
    }
    expect(JSON.stringify(result).length).toBeLessThan(4000);
    expect(listTemplates.readOnly).toBe(true);
    expect(listTemplates.http?.method).toBe("GET");
    expect(listTemplates).not.toHaveProperty("publicAgent");
  });

  it("returns whole first-slide previews below the 12k budget", async () => {
    const result = await listTemplates.run(
      listTemplates.schema.parse({ includePreview: "true" }),
    );
    for (const item of result.templates) {
      expect(item.previewHtml).toBe(
        getBuiltInDeckTemplate(item.id)?.slides[0].content,
      );
      expect(Buffer.byteLength(item.previewHtml!)).toBeLessThan(12_000);
      expect(item.previewHtml?.trim().endsWith("</div>")).toBe(true);
    }
  });

  it("filters before pagination and returns an honest empty result", async () => {
    const run = (args: Record<string, unknown>) =>
      listTemplates.run(listTemplates.schema.parse(args));
    expect(
      (await run({ search: "QUARTERLY", pageSize: 1 })).templates.map(
        (item) => item.id,
      ),
    ).toEqual(["starter-quarterly"]);
    expect((await run({ category: "pitch" })).total).toBe(1);
    expect(await run({ page: 4, pageSize: 2 })).toMatchObject({
      templates: [],
      total: 6,
      hasMore: false,
    });
    expect(await run({ search: "%_ no match" })).toMatchObject({
      templates: [],
      total: 0,
      hasMore: false,
    });
    expect(await run({ page: 1, pageSize: 2 })).toMatchObject({
      hasMore: true,
    });
    expect(
      (await run({ page: 2, pageSize: 2 })).templates.map((item) => item.id),
    ).toEqual(["starter-company", "starter-quarterly"]);
  });

  it.each([
    { pageSize: 25 },
    { page: 0 },
    { search: "x".repeat(201) },
    { category: "unknown" },
  ])("rejects invalid list bounds %j", (args) => {
    expect(listTemplates.schema.safeParse(args).success).toBe(false);
  });

  it("reads complete content without creating a deck", async () => {
    const result = await getTemplate.run({ id: "starter-pitch" });
    expect(result).toMatchObject({ id: "starter-pitch", slideCount: 5 });
    expect(result.slides).toEqual(
      getBuiltInDeckTemplate("starter-pitch")?.slides,
    );
    expect(getTemplate.readOnly).toBe(true);
    expect(getTemplate.http?.method).toBe("GET");
    expect(getTemplate).not.toHaveProperty("publicAgent");
  });

  it("fails explicitly for an unknown template", async () => {
    await expect(getTemplate.run({ id: "missing" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_template_not_found",
    });
  });
});
