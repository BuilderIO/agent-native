import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveSecret } from "@agent-native/core/server";
import {
  validateUrl,
  parseOwnerRepo,
  fetchGitHubJson,
  fetchGitHubJsonResult,
  fetchGitHubRaw,
  parseTailwindConfig,
  parseCss,
  detectStylingFramework,
  MAX_FILES,
  MAX_FILE_SIZE,
  ROOT_PATTERNS,
  SECONDARY_PATHS,
  COLOR_VAR_PATTERN,
} from "@agent-native/core/server/design-token-utils";

function githubAccessError(
  owner: string,
  repo: string,
  status: number,
  hasToken: boolean,
  message?: string,
): Error {
  const repoLabel = `${owner}/${repo}`;
  const suffix = message ? ` GitHub said: ${message}` : "";

  if (!hasToken && (status === 401 || status === 403 || status === 404)) {
    return new Error(
      `Could not access ${repoLabel}. Public repositories work without setup; private repositories require a fine-grained GitHub personal access token saved as GITHUB_TOKEN in Settings > Secrets. Limit the token to this repository and grant Repository permissions > Contents: Read-only.${suffix}`,
    );
  }

  if (hasToken && (status === 401 || status === 403 || status === 404)) {
    return new Error(
      `Could not access ${repoLabel} with the saved GITHUB_TOKEN. Check that the token is not expired, the repository is selected for the token, organization SSO/approval is complete, and Repository permissions > Contents is set to Read-only.${suffix}`,
    );
  }

  if (status === 429) {
    return new Error(
      `GitHub rate-limited requests for ${repoLabel}. Save a GITHUB_TOKEN in Settings > Secrets or try again after the rate limit resets.${suffix}`,
    );
  }

  return new Error(
    `Could not list repository contents for ${repoLabel} (GitHub returned ${status || "an error"}).${suffix}`,
  );
}

export default defineAction({
  description:
    "Import design tokens from a GitHub repository. " +
    "Reads Tailwind configs, CSS files, theme/token files, and package.json " +
    "to extract colors, fonts, spacing, and CSS custom properties. " +
    "Private repositories require a saved GITHUB_TOKEN secret; never ask users to paste a token into chat.",
  schema: z.object({
    repoUrl: z
      .string()
      .describe(
        'GitHub repository URL (e.g. "https://github.com/org/repo" or "org/repo")',
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ repoUrl }) => {
    const { owner, repo } = parseOwnerRepo(repoUrl.trim());
    const githubToken = await resolveSecret("GITHUB_TOKEN");
    const githubOptions = { token: githubToken };

    validateUrl(`https://api.github.com/repos/${owner}/${repo}`);

    const rawFiles: Record<string, string> = {};
    let fetchedCount = 0;

    async function collectFile(path: string): Promise<void> {
      if (fetchedCount >= MAX_FILES) return;
      const content = await fetchGitHubRaw(owner, repo, path, githubOptions);
      if (content) {
        rawFiles[path] = content;
        fetchedCount++;
      }
    }

    // 1. List repository root
    const rootResult = await fetchGitHubJsonResult<
      Array<{
        name: string;
        type: string;
        size?: number;
      }>
    >(owner, repo, "", githubOptions);
    const rootListing = rootResult.data;

    if (!rootResult.ok || !Array.isArray(rootListing)) {
      throw githubAccessError(
        owner,
        repo,
        rootResult.status,
        !!githubToken,
        rootResult.message,
      );
    }

    // 2. Fetch root-level files matching patterns
    const rootFilePromises: Promise<void>[] = [];
    for (const entry of rootListing) {
      if (entry.type !== "file") continue;
      if (entry.size && entry.size > MAX_FILE_SIZE) continue;
      const matches = ROOT_PATTERNS.some((p) => p.test(entry.name));
      if (matches && fetchedCount < MAX_FILES) {
        rootFilePromises.push(collectFile(entry.name));
      }
    }
    await Promise.all(rootFilePromises);

    // 3. Fetch secondary paths (files and directories)
    const secondaryPromises: Promise<void>[] = [];
    for (const path of SECONDARY_PATHS) {
      if (fetchedCount >= MAX_FILES) break;

      if (/\.\w+$/.test(path)) {
        secondaryPromises.push(collectFile(path));
      } else {
        secondaryPromises.push(
          (async () => {
            const listing = (await fetchGitHubJson(
              owner,
              repo,
              path,
              githubOptions,
            )) as Array<{
              name: string;
              type: string;
              path: string;
              size?: number;
            }> | null;
            if (!listing || !Array.isArray(listing)) return;
            const innerPromises: Promise<void>[] = [];
            for (const entry of listing) {
              if (fetchedCount >= MAX_FILES) break;
              if (entry.type !== "file") continue;
              if (entry.size && entry.size > MAX_FILE_SIZE) continue;
              if (
                /\.(css|scss|less)$/.test(entry.name) ||
                /theme/i.test(entry.name) ||
                /tokens?/i.test(entry.name)
              ) {
                innerPromises.push(collectFile(entry.path));
              }
            }
            await Promise.all(innerPromises);
          })(),
        );
      }
    }
    await Promise.all(secondaryPromises);

    // 4. Parse collected files
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
      repoUrl: `https://github.com/${owner}/${repo}`,
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
