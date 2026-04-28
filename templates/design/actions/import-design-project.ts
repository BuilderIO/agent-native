import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Import a design system from an existing design project. If a project already " +
    "has good styling (CSS custom properties, fonts, colors), this extracts those " +
    "into reusable design tokens. Alternatively, import from an existing design system " +
    "for cloning/forking. Returns extracted tokens plus raw CSS for agent refinement.",
  schema: z.object({
    designId: z.string().describe("Design project ID to extract tokens from"),
    designSystemId: z
      .string()
      .optional()
      .describe(
        "If provided, import from this existing design system instead of extracting from the design project",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, designSystemId }) => {
    // If importing from an existing design system, return its data for cloning
    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");

      const access = await resolveAccess("design-system", designSystemId);
      if (!access) {
        return "Error: Design system not found";
      }

      const row = access.resource;
      return {
        source: "design-system" as const,
        sourceId: row.id,
        sourceTitle: row.title,
        extractedTokens: {
          cssCustomProperties: {},
          colors: [],
          fonts: [],
          googleFontsLinks: [],
          borderRadius: [],
          spacing: [],
        },
        existingDesignSystem: {
          id: row.id,
          title: row.title,
          data: row.data ? JSON.parse(row.data) : null,
          assets: row.assets ? JSON.parse(row.assets) : null,
        },
      };
    }

    // Extract tokens from the design project
    await assertAccess("design", designId, "viewer");

    const access = await resolveAccess("design", designId);
    if (!access) {
      return "Error: Design not found";
    }

    const design = access.resource;
    const db = getDb();

    // Fetch all files for this design
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    // Collect all HTML content for parsing
    const htmlFiles = files.filter(
      (f) => f.fileType === "html" || f.filename.endsWith(".html"),
    );
    const cssFiles = files.filter(
      (f) => f.fileType === "css" || f.filename.endsWith(".css"),
    );
    const allContent = [...htmlFiles, ...cssFiles]
      .map((f) => f.content)
      .join("\n");

    // Extract CSS custom properties from :root and style blocks
    const cssCustomProperties: Record<string, string> = {};
    const cssVarMatches = allContent.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
    for (const match of cssVarMatches) {
      cssCustomProperties[`--${match[1]}`] = match[2].trim();
    }

    // Extract color values (hex, rgb, hsl)
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

    // Extract font family declarations
    const fonts: { family: string; weight?: string }[] = [];
    const fontFamilySet = new Set<string>();

    // From font-family CSS declarations
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

    // From @font-face blocks
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

    // Extract Google Fonts links
    const googleFontsLinks: string[] = [];
    const googleFontPattern =
      /https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'>\s]+/g;
    let gfMatch;
    while ((gfMatch = googleFontPattern.exec(allContent)) !== null) {
      googleFontsLinks.push(gfMatch[0]);
    }

    // Extract border radius values
    const borderRadiusSet = new Set<string>();
    const radiusPattern = /border-radius\s*:\s*([^;}\n]+)/g;
    let radiusMatch;
    while ((radiusMatch = radiusPattern.exec(allContent)) !== null) {
      borderRadiusSet.add(radiusMatch[1].trim());
    }
    // Also from CSS custom properties named with "radius"
    for (const [key, value] of Object.entries(cssCustomProperties)) {
      if (key.toLowerCase().includes("radius")) {
        borderRadiusSet.add(value);
      }
    }

    // Extract spacing/gap patterns
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
    // Also from CSS custom properties named with "spacing" or "gap"
    for (const [key, value] of Object.entries(cssCustomProperties)) {
      if (
        key.toLowerCase().includes("spacing") ||
        key.toLowerCase().includes("gap")
      ) {
        spacingSet.add(value);
      }
    }

    // Collect raw CSS from style blocks and CSS files
    const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/g;
    const rawCSSParts: string[] = [];
    let styleMatch;
    while ((styleMatch = styleBlockPattern.exec(allContent)) !== null) {
      rawCSSParts.push(styleMatch[1].trim());
    }
    for (const cssFile of cssFiles) {
      rawCSSParts.push(cssFile.content);
    }

    // Look up linked design system if any
    let existingDesignSystem: {
      id: string;
      title: string;
      data: any;
      assets: any;
    } | null = null;
    if (design.designSystemId) {
      const dsAccess = await resolveAccess(
        "design-system",
        design.designSystemId,
      );
      if (dsAccess) {
        const ds = dsAccess.resource;
        existingDesignSystem = {
          id: ds.id,
          title: ds.title,
          data: ds.data ? JSON.parse(ds.data) : null,
          assets: ds.assets ? JSON.parse(ds.assets) : null,
        };
      }
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
      existingDesignSystem,
      rawCSS: rawCSSParts.join("\n\n") || undefined,
    };
  },
});
