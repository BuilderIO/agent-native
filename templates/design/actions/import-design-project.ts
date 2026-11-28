import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Extract design tokens from an existing design project. If a project already " +
    "has good styling (CSS custom properties, fonts, colors), this extracts those " +
    "into reusable design tokens. Returns extracted tokens plus raw CSS for agent refinement.",
  schema: z.object({
    designId: z.string().describe("Design project ID to extract tokens from"),
  }),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: "search",
  run: async ({ designId }) => {
    await assertAccess("design", designId, "viewer");

    const access = await resolveAccess("design", designId);
    if (!access) {
      fail("Design not found", { errorCode: "not_found", statusCode: 404 });
    }

    const design = access.resource;
    const db = getDb();

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    const htmlFiles = files.filter(
      (f) => f.fileType === "html" || f.filename.endsWith(".html"),
    );
    const cssFiles = files.filter(
      (f) => f.fileType === "css" || f.filename.endsWith(".css"),
    );
    const allContent = [...htmlFiles, ...cssFiles]
      .map((f) => f.content)
      .join("\n");

    const cssCustomProperties: Record<string, string> = {};
    const cssVarMatches = allContent.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
    for (const match of cssVarMatches) {
      cssCustomProperties[`--${match[1]}`] = match[2].trim();
    }

    const colorSet = new Set<string>();

    const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
    let hexMatch;
    while ((hexMatch = hexPattern.exec(allContent)) !== null) {
      colorSet.add(hexMatch[0]);
    }

    const rgbPattern =
      /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
    let rgbMatch;
    while ((rgbMatch = rgbPattern.exec(allContent)) !== null) {
      colorSet.add(rgbMatch[0]);
    }

    const hslPattern =
      /hsla?\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/g;
    let hslMatch;
    while ((hslMatch = hslPattern.exec(allContent)) !== null) {
      colorSet.add(hslMatch[0]);
    }

    const fonts: { family: string; weight?: string }[] = [];
    const fontFamilySet = new Set<string>();

    const fontFamilyPattern = /font-family\s*:\s*["']?([^"';}\n]+)["']?/g;
    let fontMatch;
    while ((fontMatch = fontFamilyPattern.exec(allContent)) !== null) {
      const family = fontMatch[1]
        .trim()
        .split(",")[0]
        .trim()
        .replace(/["']/g, "");
      if (family && !fontFamilySet.has(family)) {
        fontFamilySet.add(family);
        fonts.push({ family });
      }
    }

    const fontFaceMatches = allContent.matchAll(/@font-face\s*\{([^}]+)\}/g);
    for (const match of fontFaceMatches) {
      const block = match[1];
      const familyMatch = block.match(/font-family\s*:\s*["']?([^"';]+)["']?/);
      const weightMatch = block.match(/font-weight\s*:\s*([^;}\n]+)/);
      if (familyMatch) {
        const family = familyMatch[1].trim();
        if (!fontFamilySet.has(family)) {
          fontFamilySet.add(family);
          fonts.push({
            family,
            weight: weightMatch?.[1]?.trim(),
          });
        }
      }
    }

    const googleFontsLinks: string[] = [];
    const googleFontPattern =
      /https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'>\s]+/g;
    let gfMatch;
    while ((gfMatch = googleFontPattern.exec(allContent)) !== null) {
      googleFontsLinks.push(gfMatch[0]);
    }

    const borderRadiusSet = new Set<string>();
    const radiusPattern = /border-radius\s*:\s*([^;}\n]+)/g;
    let radiusMatch;
    while ((radiusMatch = radiusPattern.exec(allContent)) !== null) {
      borderRadiusSet.add(radiusMatch[1].trim());
    }
    for (const [key, value] of Object.entries(cssCustomProperties)) {
      if (key.toLowerCase().includes("radius")) {
        borderRadiusSet.add(value);
      }
    }

    const spacingSet = new Set<string>();
    const gapPattern = /gap\s*:\s*([^;}\n]+)/g;
    let gapMatch;
    while ((gapMatch = gapPattern.exec(allContent)) !== null) {
      spacingSet.add(gapMatch[1].trim());
    }
    const paddingPattern = /padding\s*:\s*([^;}\n]+)/g;
    let padMatch;
    while ((padMatch = paddingPattern.exec(allContent)) !== null) {
      spacingSet.add(padMatch[1].trim());
    }
    for (const [key, value] of Object.entries(cssCustomProperties)) {
      if (
        key.toLowerCase().includes("spacing") ||
        key.toLowerCase().includes("gap")
      ) {
        spacingSet.add(value);
      }
    }

    const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/g;
    const rawCSSParts: string[] = [];
    let styleMatch;
    while ((styleMatch = styleBlockPattern.exec(allContent)) !== null) {
      rawCSSParts.push(styleMatch[1].trim());
    }
    for (const cssFile of cssFiles) {
      rawCSSParts.push(cssFile.content);
    }

    return {
      source: "design-project" as const,
      sourceId: design.id,
      sourceTitle: design.title,
      extractedTokens: {
        cssCustomProperties,
        colors: [...colorSet].slice(0, 50),
        fonts,
        googleFontsLinks,
        borderRadius: [...borderRadiusSet],
        spacing: [...spacingSet].slice(0, 30),
      },
      rawCSS: rawCSSParts.join("\n\n") || undefined,
    };
  },
});
