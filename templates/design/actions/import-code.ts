import { defineAction } from "@agent-native/core";
import { z } from "zod";

const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 500 * 1024; // 500 KB

export default defineAction({
  description:
    "Extract design tokens from raw code files uploaded from the browser. " +
    "Analyzes CSS, Tailwind configs, JSON theme files, package.json, and " +
    "TypeScript/JavaScript theme files to extract colors, fonts, spacing, " +
    "border-radius, and CSS custom properties. Returns a structured summary " +
    "the agent can use to create or update a design system.",
  schema: z.object({
    files: z
      .array(
        z.object({
          filename: z.string().describe("File name or relative path"),
          content: z.string().describe("Raw text content of the file"),
        }),
      )
      .describe("Array of code files to analyze"),
  }),
  readOnly: true,
  run: async ({ files }) => {
    // Enforce limits
    const truncated = files.slice(0, MAX_FILES);
    let totalBytes = 0;
    const accepted: { filename: string; content: string }[] = [];
    for (const file of truncated) {
      const size = new TextEncoder().encode(file.content).byteLength;
      if (totalBytes + size > MAX_TOTAL_BYTES) break;
      totalBytes += size;
      accepted.push(file);
    }

    const colors: Record<string, string> = {};
    const cssCustomProperties: Record<string, string> = {};
    const fonts: { family: string; source?: string }[] = [];
    const spacing: Record<string, string> = {};
    const borderRadius: Record<string, string> = {};
    let stylingFramework: string | null = null;
    const rawExtracts: { filename: string; type: string; data: unknown }[] = [];
    const filesAnalyzed: string[] = [];

    const seenFonts = new Set<string>();

    function addFont(family: string, source?: string) {
      const normalized = family.trim().replace(/["']/g, "");
      if (!normalized || seenFonts.has(normalized.toLowerCase())) return;
      seenFonts.add(normalized.toLowerCase());
      fonts.push({ family: normalized, source });
    }

    function extractCssVars(content: string, filename: string) {
      const pattern = /--([\w-]+)\s*:\s*([^;}\n]+)/g;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = `--${match[1]}`;
        const value = match[2].trim();
        cssCustomProperties[name] = value;

        // Classify the variable
        if (
          /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground/i.test(
            match[1],
          )
        ) {
          colors[name] = value;
        } else if (/spacing|gap|padding|margin|space/i.test(match[1])) {
          spacing[name] = value;
        } else if (/radius|rounded/i.test(match[1])) {
          borderRadius[name] = value;
        }
      }
    }

    function extractColors(content: string, filename: string) {
      // Hex colors
      const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
      let m;
      while ((m = hexPattern.exec(content)) !== null) {
        colors[m[0]] = m[0];
      }

      // RGB/RGBA
      const rgbPattern =
        /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
      while ((m = rgbPattern.exec(content)) !== null) {
        colors[m[0]] = m[0];
      }

      // HSL/HSLA
      const hslPattern =
        /hsla?\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/g;
      while ((m = hslPattern.exec(content)) !== null) {
        colors[m[0]] = m[0];
      }

      // OKLCH
      const oklchPattern =
        /oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+)?\s*\)/g;
      while ((m = oklchPattern.exec(content)) !== null) {
        colors[m[0]] = m[0];
      }
    }

    function extractFonts(content: string, filename: string) {
      // font-family declarations
      const fontFamilyPattern = /font-family\s*:\s*["']?([^"';}\n]+)/g;
      let m;
      while ((m = fontFamilyPattern.exec(content)) !== null) {
        // Split comma-separated families and take the first
        const families = m[1].split(",");
        for (const fam of families) {
          const trimmed = fam.trim().replace(/["']/g, "");
          if (
            trimmed &&
            !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial)$/i.test(
              trimmed,
            )
          ) {
            addFont(trimmed, filename);
          }
        }
      }

      // @font-face blocks
      const fontFacePattern = /@font-face\s*\{([^}]+)\}/g;
      while ((m = fontFacePattern.exec(content)) !== null) {
        const block = m[1];
        const familyMatch = block.match(
          /font-family\s*:\s*["']?([^"';]+)["']?/,
        );
        if (familyMatch) {
          addFont(familyMatch[1], filename);
        }
      }
    }

    function analyzeCssFile(content: string, filename: string) {
      extractCssVars(content, filename);
      extractColors(content, filename);
      extractFonts(content, filename);

      rawExtracts.push({ filename, type: "css", data: { parsed: true } });
    }

    function analyzeTailwindConfig(content: string, filename: string) {
      stylingFramework = "tailwind";

      // Extract colors block via regex
      const colorsBlockMatch = content.match(/colors\s*:\s*\{([\s\S]*?)\}/);
      if (colorsBlockMatch) {
        // Extract key-value pairs from the colors block
        const pairPattern = /["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g;
        let m;
        while ((m = pairPattern.exec(colorsBlockMatch[1])) !== null) {
          colors[m[1]] = m[2];
        }
      }

      // Extract fontFamily block
      const fontFamilyBlockMatch = content.match(
        /fontFamily\s*:\s*\{([\s\S]*?)\}/,
      );
      if (fontFamilyBlockMatch) {
        const fontPairPattern =
          /["']?([\w-]+)["']?\s*:\s*\[?\s*["']([^"']+)["']/g;
        let m;
        while ((m = fontPairPattern.exec(fontFamilyBlockMatch[1])) !== null) {
          addFont(m[2], filename);
        }
      }

      // Extract spacing block
      const spacingBlockMatch = content.match(/spacing\s*:\s*\{([\s\S]*?)\}/);
      if (spacingBlockMatch) {
        const pairPattern = /["']?([\w.-]+)["']?\s*:\s*["']([^"']+)["']/g;
        let m;
        while ((m = pairPattern.exec(spacingBlockMatch[1])) !== null) {
          spacing[m[1]] = m[2];
        }
      }

      // Extract borderRadius block
      const radiusBlockMatch = content.match(
        /borderRadius\s*:\s*\{([\s\S]*?)\}/,
      );
      if (radiusBlockMatch) {
        const pairPattern = /["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g;
        let m;
        while ((m = pairPattern.exec(radiusBlockMatch[1])) !== null) {
          borderRadius[m[1]] = m[2];
        }
      }

      // Also extract any standalone hex/color values
      extractColors(content, filename);

      rawExtracts.push({
        filename,
        type: "tailwind-config",
        data: {
          hasColors: !!colorsBlockMatch,
          hasFontFamily: !!fontFamilyBlockMatch,
          hasSpacing: !!spacingBlockMatch,
          hasBorderRadius: !!radiusBlockMatch,
        },
      });
    }

    function analyzeJsonTheme(content: string, filename: string) {
      try {
        const json = JSON.parse(content);
        const walk = (obj: Record<string, unknown>, prefix: string) => {
          for (const [key, value] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (typeof value === "string") {
              const lower = key.toLowerCase();
              if (
                /color|bg|background|text|border|accent|primary|secondary|surface/i.test(
                  lower,
                ) ||
                /^#[0-9a-fA-F]{3,8}$/.test(value)
              ) {
                colors[path] = value;
              } else if (/font|family|typeface/i.test(lower)) {
                addFont(value, filename);
              } else if (/spacing|gap|padding|margin|space/i.test(lower)) {
                spacing[path] = value;
              } else if (/radius|rounded/i.test(lower)) {
                borderRadius[path] = value;
              }
            } else if (
              value &&
              typeof value === "object" &&
              !Array.isArray(value)
            ) {
              walk(value as Record<string, unknown>, path);
            }
          }
        };
        walk(json, "");
        rawExtracts.push({
          filename,
          type: "json-theme",
          data: { keys: Object.keys(json) },
        });
      } catch {
        rawExtracts.push({
          filename,
          type: "json-theme",
          data: { parseError: true },
        });
      }
    }

    function analyzePackageJson(content: string, filename: string) {
      try {
        const json = JSON.parse(content);
        const allDeps = {
          ...json.dependencies,
          ...json.devDependencies,
        };

        const frameworks: { name: string; label: string }[] = [
          { name: "tailwindcss", label: "tailwind" },
          { name: "@tailwindcss/cli", label: "tailwind" },
          { name: "styled-components", label: "styled-components" },
          { name: "@emotion/react", label: "emotion" },
          { name: "@emotion/styled", label: "emotion" },
          { name: "sass", label: "sass" },
          { name: "less", label: "less" },
          { name: "postcss", label: "postcss" },
          { name: "css-modules", label: "css-modules" },
          { name: "@vanilla-extract/css", label: "vanilla-extract" },
          { name: "stitches", label: "stitches" },
          { name: "panda-css", label: "panda-css" },
          { name: "@pandacss/dev", label: "panda-css" },
          { name: "unocss", label: "unocss" },
          { name: "windicss", label: "windi" },
        ];

        const detected: string[] = [];
        for (const fw of frameworks) {
          if (allDeps && fw.name in allDeps) {
            detected.push(fw.label);
            if (!stylingFramework) {
              stylingFramework = fw.label;
            }
          }
        }

        rawExtracts.push({
          filename,
          type: "package-json",
          data: { stylingDeps: detected },
        });
      } catch {
        rawExtracts.push({
          filename,
          type: "package-json",
          data: { parseError: true },
        });
      }
    }

    function analyzeThemeSourceFile(content: string, filename: string) {
      // Extract hex color values with their variable/key names
      const namedHexPattern =
        /(?:const|let|var|export)\s+(\w+)\s*=\s*["']?(#[0-9a-fA-F]{3,8})\b/g;
      let m;
      while ((m = namedHexPattern.exec(content)) !== null) {
        colors[m[1]] = m[2];
      }

      // Extract object key-value hex pairs: key: "#hex"
      const kvHexPattern =
        /["']?([\w-]+)["']?\s*:\s*["'](#[0-9a-fA-F]{3,8})["']/g;
      while ((m = kvHexPattern.exec(content)) !== null) {
        colors[m[1]] = m[2];
      }

      // Extract font family strings
      const fontStringPattern =
        /(?:font|family|typeface)\w*\s*[:=]\s*["']([^"']+)["']/gi;
      while ((m = fontStringPattern.exec(content)) !== null) {
        addFont(m[1], filename);
      }

      // Extract spacing values
      const spacingPattern =
        /(?:spacing|gap|padding|margin)\w*\s*[:=]\s*["']([^"']+)["']/gi;
      while ((m = spacingPattern.exec(content)) !== null) {
        spacing[m[0].split(/[:=]/)[0].trim()] = m[1];
      }

      // Also extract standalone colors
      extractColors(content, filename);

      rawExtracts.push({
        filename,
        type: "theme-source",
        data: { parsed: true },
      });
    }

    // Process each file
    for (const file of accepted) {
      const name = file.filename.toLowerCase();
      const basename = name.split("/").pop() ?? name;
      filesAnalyzed.push(file.filename);

      if (basename.startsWith("tailwind.config")) {
        analyzeTailwindConfig(file.content, file.filename);
      } else if (basename === "package.json") {
        analyzePackageJson(file.content, file.filename);
      } else if (
        basename === "theme.json" ||
        basename === "tokens.json" ||
        basename.endsWith(".tokens.json")
      ) {
        analyzeJsonTheme(file.content, file.filename);
      } else if (name.endsWith(".css")) {
        analyzeCssFile(file.content, file.filename);
      } else if (
        /^theme\.(ts|js)$/.test(basename) ||
        /^tokens\.(ts|js)$/.test(basename)
      ) {
        analyzeThemeSourceFile(file.content, file.filename);
      } else if (
        name.endsWith(".ts") ||
        name.endsWith(".tsx") ||
        name.endsWith(".js") ||
        name.endsWith(".jsx")
      ) {
        // Generic TS/JS files: light-pass for colors and fonts
        extractColors(file.content, file.filename);
        extractFonts(file.content, file.filename);
        extractCssVars(file.content, file.filename);
        rawExtracts.push({
          filename: file.filename,
          type: "source",
          data: { lightPass: true },
        });
      } else if (name.endsWith(".json")) {
        // Other JSON files: try to parse for tokens
        analyzeJsonTheme(file.content, file.filename);
      } else if (
        name.endsWith(".scss") ||
        name.endsWith(".sass") ||
        name.endsWith(".less")
      ) {
        // Pre-processor stylesheets: same extraction as CSS
        analyzeCssFile(file.content, file.filename);
        if (!stylingFramework) {
          stylingFramework = name.endsWith(".less") ? "less" : "sass";
        }
      }
    }

    // Cap output sizes to keep response reasonable
    const cappedColors = Object.fromEntries(
      Object.entries(colors).slice(0, 60),
    );
    const cappedCssProps = Object.fromEntries(
      Object.entries(cssCustomProperties).slice(0, 80),
    );

    return {
      source: "code" as const,
      fileCount: accepted.length,
      filesAnalyzed,
      colors: cappedColors,
      cssCustomProperties: cappedCssProps,
      fonts: fonts.slice(0, 20),
      spacing,
      borderRadius,
      stylingFramework,
      rawExtracts,
    };
  },
});
