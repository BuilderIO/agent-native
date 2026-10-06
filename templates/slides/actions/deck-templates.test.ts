import { describe, expect, it } from "vitest";

import {
  DECK_TEMPLATE_CATEGORIES,
  getBuiltInDeckTemplate,
  listBuiltInDeckTemplates,
} from "../server/lib/deck-templates.js";
import getTemplate from "./get-deck-template.js";
import listTemplates from "./list-deck-templates.js";

const TEMPLATE_COUNT = 18;

describe("built-in deck templates", () => {
  it("contains independent, complete multi-slide starters for every category", () => {
    const templates = listBuiltInDeckTemplates();
    expect(new Set(templates.map((item) => item.category))).toEqual(
      new Set(DECK_TEMPLATE_CATEGORIES),
    );
    expect(new Set(templates.map((item) => item.id)).size).toBe(TEMPLATE_COUNT);
    expect(
      new Set(templates.flatMap((item) => item.slides.map((slide) => slide.id)))
        .size,
    ).toBe(templates.flatMap((item) => item.slides).length);
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
      total: TEMPLATE_COUNT,
      page: 1,
      pageSize: 6,
      hasMore: true,
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
      (await run({ search: "QUARTERLY", pageSize: 24 })).templates.map(
        (item) => item.id,
      ),
    ).toContain("starter-quarterly");
    expect(
      (await run({ category: "pitch" })).templates.map((item) => item.id),
    ).toContain("starter-pitch");
    expect(
      (await run({ category: "keynote" })).templates.every(
        (item) => item.category === "keynote",
      ),
    ).toBe(true);
    expect(
      await run({ page: TEMPLATE_COUNT / 2 + 1, pageSize: 2 }),
    ).toMatchObject({
      templates: [],
      total: TEMPLATE_COUNT,
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
    ).toEqual(
      listBuiltInDeckTemplates()
        .slice(2, 4)
        .map((item) => item.id),
    );
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
    expect(result).toMatchObject({
      id: "starter-pitch",
      slideCount: getBuiltInDeckTemplate("starter-pitch")!.slides.length,
    });
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
