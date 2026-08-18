import { defineAction } from "@agent-native/core";
import { collectBuilderDesignSystemGitHubFiles } from "@agent-native/core/server";
import {
  parseTailwindConfig,
  parseCss,
  detectStylingFramework,
  COLOR_VAR_PATTERN,
} from "@agent-native/core/server/design-token-utils";
import { z } from "zod";

export default defineAction({
  description:
    "Import design tokens from a GitHub repository. " +
    "Reads Tailwind configs, CSS files, theme/token files, and package.json " +
    "to extract colors, fonts, spacing, and CSS custom properties. Supports a pinned ref and file/folder scope. " +
    "Private repositories require a saved GITHUB_TOKEN secret; never ask users to paste a token into chat.",
  schema: z.object({
    repoUrl: z
      .string()
      .describe(
        'GitHub repository URL (e.g. "https://github.com/org/repo" or "org/repo")',
      ),
    ref: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional branch, tag, or commit"),
    include: z
      .array(z.string().trim().min(1))
      .optional()
      .describe("Optional repository-relative files or folders to include"),
    exclude: z
      .array(z.string().trim().min(1))
      .optional()
      .describe("Optional repository-relative files or folders to exclude"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ repoUrl, ref, include, exclude }) => {
    const collection = await collectBuilderDesignSystemGitHubFiles({
      repoUrl: repoUrl.trim(),
      ...(ref ? { ref } : {}),
      ...(include ? { include } : {}),
      ...(exclude ? { exclude } : {}),
    });
    const { source } = collection;
    const rawFiles = Object.fromEntries(
      collection.files.map(({ path, content }) => [path, content]),
    );

    // Parse collected files
    let colors: Record<string, unknown> = {};
    let fonts: string[] = [];
    let spacing: Record<string, string> = {};
    let borderRadius: Record<string, string> = {};
    let cssCustomProperties: Record<string, string> = {};
    let stylingFramework: string | undefined;

    for (const [filename, content] of Object.entries(rawFiles)) {
      if (/tailwind\.config\.\w+$/.test(filename)) {
        const tw = parseTailwindConfig(content);
        if (tw.colors)
          colors = { ...colors, ...(tw.colors as Record<string, unknown>) };
        if (tw.fontFamily) {
          fonts.push(...Object.values(tw.fontFamily as Record<string, string>));
        }
        if (tw.spacing)
          spacing = { ...spacing, ...(tw.spacing as Record<string, string>) };
        if (tw.borderRadius) {
          borderRadius = {
            ...borderRadius,
            ...(tw.borderRadius as Record<string, string>),
          };
        }
      }

      if (/\.(css|scss|less)$/.test(filename)) {
        const parsed = parseCss(content);
        if (parsed.cssCustomProperties) {
          cssCustomProperties = {
            ...cssCustomProperties,
            ...parsed.cssCustomProperties,
          };
        }
        if (parsed.fonts) fonts.push(...parsed.fonts);
      }

      if (filename === "package.json") {
        stylingFramework = detectStylingFramework(content);
      }
    }

    fonts = [...new Set(fonts)];

    for (const [key, value] of Object.entries(cssCustomProperties)) {
      if (COLOR_VAR_PATTERN.test(value.trim()) && !colors[key]) {
        colors[key] = value.trim();
      }
    }

    return {
      source: "github" as const,
      repoUrl: source.repoUrl,
      ...(source.ref ? { ref: source.ref } : {}),
      ...(source.include?.length ? { include: source.include } : {}),
      ...(source.exclude?.length ? { exclude: source.exclude } : {}),
      colors: Object.keys(colors).length > 0 ? colors : undefined,
      fonts: fonts.length > 0 ? fonts : undefined,
      spacing: Object.keys(spacing).length > 0 ? spacing : undefined,
      borderRadius:
        Object.keys(borderRadius).length > 0 ? borderRadius : undefined,
      cssCustomProperties:
        Object.keys(cssCustomProperties).length > 0
          ? cssCustomProperties
          : undefined,
      stylingFramework,
      rawFiles,
    };
  },
});
