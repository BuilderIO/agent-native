import fs from "fs/promises";
import path from "path";

import fg from "fast-glob";
import { Project } from "ts-morph";

import type {
  BehaviorGraph,
  ComponentGraph,
  ContentGraph,
  ProjectIR,
  SiteGraph,
  SiteRoute,
  SourceAdapter,
} from "../types.js";

const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx"];

export const nextjsSourceAdapter: SourceAdapter = {
  id: "nextjs",
  label: "Next.js",
  kind: "deterministic",
  inputKinds: ["path"],
  detect: detectNextJsSource,
  introspect: extractNextJsProject,
};

export async function detectNextJsSource(sourceRoot: string): Promise<boolean> {
  const pkg = await readJson(path.join(sourceRoot, "package.json"));
  const dependencies = isRecord(pkg?.dependencies) ? pkg.dependencies : {};
  const devDependencies = isRecord(pkg?.devDependencies)
    ? pkg.devDependencies
    : {};
  const deps = {
    ...dependencies,
    ...devDependencies,
  };
  if (deps.next) return true;
  return (
    (await exists(path.join(sourceRoot, "next.config.js"))) ||
    (await exists(path.join(sourceRoot, "next.config.mjs"))) ||
    (await exists(path.join(sourceRoot, "next.config.ts"))) ||
    (await exists(path.join(sourceRoot, "pages"))) ||
    (await exists(path.join(sourceRoot, "app")))
  );
}

export async function extractNextJsProject(
  sourceRoot: string,
): Promise<ProjectIR> {
  const [site, components, content, behavior] = await Promise.all([
    extractSiteGraph(sourceRoot),
    extractComponentGraph(sourceRoot),
    extractContentGraph(sourceRoot),
    extractBehaviorGraph(sourceRoot),
  ]);
  return { site, components, content, behavior };
}

async function extractSiteGraph(sourceRoot: string): Promise<SiteGraph> {
  const routeFiles = await fg(
    [
      "pages/**/*.{ts,tsx,js,jsx,md,mdx}",
      "app/**/{page,route}.{ts,tsx,js,jsx,md,mdx}",
    ],
    {
      cwd: sourceRoot,
      dot: false,
      ignore: [
        "**/node_modules/**",
        "**/.next/**",
        "pages/_app.*",
        "pages/_document.*",
      ],
    },
  );

  const routes: SiteRoute[] = routeFiles
    .map((filePath) => routeFromFile(filePath))
    .filter((route): route is SiteRoute => Boolean(route))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    framework: "nextjs",
    sourceRoot,
    routes,
    redirects: [],
    metadata: {
      routerKinds: [...new Set(routes.map((r) => r.router))],
      routeCount: routes.length,
    },
  };
}

function routeFromFile(filePath: string): SiteRoute | null {
  const normalized = filePath.split(path.sep).join("/");
  const router = normalized.startsWith("app/") ? "next-app" : "next-pages";
  const isAppRoute = router === "next-app";
  const isApi =
    normalized.startsWith("pages/api/") ||
    normalized.includes("/api/") ||
    normalized.endsWith("/route.ts") ||
    normalized.endsWith("/route.tsx") ||
    normalized.endsWith("/route.js") ||
    normalized.endsWith("/route.jsx");

  if (
    isAppRoute &&
    !/\/(page|route)\.[tj]sx?$|\/(page|route)\.mdx?$/.test(normalized)
  ) {
    return null;
  }

  let routePath = normalized;
  if (isAppRoute) {
    routePath = routePath
      .replace(/^app\//, "")
      .replace(/(^|\/)(page|route)\.(ts|tsx|js|jsx|md|mdx)$/, "");
  } else {
    routePath = routePath
      .replace(/^pages\//, "")
      .replace(/\.(ts|tsx|js|jsx|md|mdx)$/, "");
  }

  routePath = routePath
    .replace(/\/index$/, "")
    .replace(/^index$/, "")
    .replace(/^\(.*?\)\//, "")
    .replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, dots: string, name: string) =>
      dots ? `*${name}` : `:${name}`,
    );

  const publicPath = routePath ? `/${routePath}` : "/";
  const pathValue = publicPath === "/api" && isApi ? "/api/*" : publicPath;
  const routeKind = isApi
    ? "api"
    : pathValue === "/" ||
        pathValue.includes("pricing") ||
        pathValue.includes("blog") ||
        pathValue.includes("docs")
      ? pathValue.includes("docs")
        ? "docs"
        : pathValue === "/"
          ? "landing"
          : "marketing"
      : "app";

  return {
    id: stableId(normalized),
    path: pathValue,
    filePath: normalized,
    router,
    kind: routeKind,
    dynamic: pathValue.includes(":") || pathValue.includes("*"),
    public: routeKind !== "app" && routeKind !== "api",
    notes: isApi
      ? [
          "Convert to an action unless it uploads, streams, handles OAuth, or receives webhooks.",
        ]
      : [],
  };
}

async function extractComponentGraph(
  sourceRoot: string,
): Promise<ComponentGraph> {
  const componentFiles = await fg(
    [
      "components/**/*.{ts,tsx,js,jsx}",
      "app/components/**/*.{ts,tsx,js,jsx}",
      "src/components/**/*.{ts,tsx,js,jsx}",
    ],
    {
      cwd: sourceRoot,
      ignore: ["**/node_modules/**", "**/.next/**"],
    },
  );

  return {
    components: componentFiles.sort().map((filePath) => ({
      id: stableId(filePath),
      name: componentName(filePath),
      filePath,
      usedByRoutes: [],
    })),
    designTokens: {},
  };
}

async function extractContentGraph(sourceRoot: string): Promise<ContentGraph> {
  const assets = await fg(
    [
      "public/**/*.{png,jpg,jpeg,webp,gif,svg,avif,pdf,mp4,webm}",
      "app/**/*.{png,jpg,jpeg,webp,gif,svg,avif,pdf,mp4,webm}",
      "src/**/*.{png,jpg,jpeg,webp,gif,svg,avif,pdf,mp4,webm}",
    ],
    {
      cwd: sourceRoot,
      ignore: ["**/node_modules/**", "**/.next/**"],
    },
  );

  return {
    models: [],
    assets: assets.sort().map((assetPath) => ({
      id: stableId(assetPath),
      path: assetPath,
      type: path.extname(assetPath).slice(1) || "unknown",
    })),
  };
}

async function extractBehaviorGraph(
  sourceRoot: string,
): Promise<BehaviorGraph> {
  const codeFiles = await fg(`**/*.{${CODE_EXTENSIONS.join(",")}}`, {
    cwd: sourceRoot,
    ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/build/**"],
  });
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 4 },
  });

  const behavior: BehaviorGraph = {
    apiEndpoints: [],
    dataStores: [],
    llmCalls: [],
    clientState: [],
    auth: [],
    jobs: [],
  };

  for (const relativePath of codeFiles.sort()) {
    const absolutePath = path.join(sourceRoot, relativePath);
    let text = "";
    try {
      text = await fs.readFile(absolutePath, "utf-8");
    } catch {
      continue;
    }

    if (
      relativePath.startsWith("pages/api/") ||
      /\/api\/.*\/route\.[tj]sx?$/.test(relativePath)
    ) {
      behavior.apiEndpoints.push({
        id: stableId(relativePath),
        path: apiPathFromFile(relativePath),
        method: inferHttpMethod(text),
        filePath: relativePath,
        recommendedRecipe: "api-routes-to-actions",
      });
    }

    if (/\b(useState|useReducer|localStorage|sessionStorage)\b/.test(text)) {
      behavior.clientState.push({
        id: stableId(`${relativePath}:state`),
        filePath: relativePath,
        reason:
          "Review for important state that should move into application_state.",
      });
    }

    if (
      /\b(openai|anthropic|generateText|streamText|chat\.completions|messages\.create)\b/i.test(
        text,
      )
    ) {
      behavior.llmCalls.push({
        id: stableId(`${relativePath}:llm`),
        filePath: relativePath,
        provider: inferLlmProvider(text),
      });
    }

    if (
      /\b(prisma|drizzle|mongoose|sequelize|supabase|neon|turso|postgres|mysql|sqlite)\b/i.test(
        text,
      )
    ) {
      behavior.dataStores.push({
        id: stableId(`${relativePath}:data`),
        name: inferDataStoreName(text),
        filePath: relativePath,
        kind: "database",
      });
    }

    if (/\b(next-auth|auth0|clerk|better-auth|middleware)\b/i.test(text)) {
      behavior.auth.push({
        id: stableId(`${relativePath}:auth`),
        filePath: relativePath,
        provider: inferAuthProvider(text),
      });
    }

    if (/\b(cron|schedule|queue|worker|inngest|trigger)\b/i.test(text)) {
      behavior.jobs.push({
        id: stableId(`${relativePath}:job`),
        filePath: relativePath,
        kind: "scheduled-or-background-work",
      });
    }

    try {
      const sourceFile = project.createSourceFile(relativePath, text, {
        overwrite: true,
      });
      for (const importDecl of sourceFile.getImportDeclarations()) {
        const specifier = importDecl.getModuleSpecifierValue();
        if (/^(openai|@anthropic-ai|ai$|@ai-sdk)/.test(specifier)) {
          behavior.llmCalls.push({
            id: stableId(`${relativePath}:${specifier}`),
            filePath: relativePath,
            provider: specifier,
          });
        }
      }
    } catch {
      // ts-morph is a semantic assist, not a hard blocker for inventory.
    }
  }

  behavior.llmCalls = uniqueBy(
    behavior.llmCalls,
    (item) => `${item.filePath}:${item.provider}`,
  );
  return behavior;
}

function apiPathFromFile(filePath: string): string {
  if (filePath.startsWith("pages/api/")) {
    return `/${filePath
      .replace(/^pages\//, "")
      .replace(/\.(ts|tsx|js|jsx)$/, "")
      .replace(/\/index$/, "")
      .replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, dots: string, name: string) =>
        dots ? `*${name}` : `:${name}`,
      )}`;
  }
  return `/${filePath
    .replace(/^app\//, "")
    .replace(/\/route\.(ts|tsx|js|jsx)$/, "")
    .replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, dots: string, name: string) =>
      dots ? `*${name}` : `:${name}`,
    )}`;
}

function inferHttpMethod(text: string): string {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const found = methods.filter((method) =>
    new RegExp(
      `\\b(export\\s+async\\s+function\\s+${method}|req\\.method\\s*===\\s*['"]${method}['"])`,
    ).test(text),
  );
  return found.length ? found.join(",") : "ANY";
}

function inferLlmProvider(text: string): string {
  if (/anthropic/i.test(text)) return "anthropic";
  if (/openai/i.test(text)) return "openai";
  if (/@ai-sdk|generateText|streamText/.test(text)) return "ai-sdk";
  return "unknown";
}

function inferDataStoreName(text: string): string {
  const names = ["prisma", "drizzle", "supabase", "neon", "turso", "postgres"];
  return names.find((name) => text.toLowerCase().includes(name)) ?? "unknown";
}

function inferAuthProvider(text: string): string {
  const names = ["next-auth", "auth0", "clerk", "better-auth"];
  return names.find((name) => text.toLowerCase().includes(name)) ?? "unknown";
}

function componentName(filePath: string): string {
  const base = path.basename(filePath).replace(/\.(ts|tsx|js|jsx)$/, "");
  return base
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function readJson(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf-8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stableId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(item);
  }
  return out;
}
