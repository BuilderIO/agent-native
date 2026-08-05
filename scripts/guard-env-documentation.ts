#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const INVENTORY_DOCUMENTATION_PATH = path.join(
  REPO_ROOT,
  "docs/environment-variables.md",
);
const PUBLIC_DOCUMENTATION_PATH = path.join(
  REPO_ROOT,
  "packages/core/docs/content/environment-variables.mdx",
);

const PUBLIC_EXACT_KEYS = new Set([
  "ACCESS_TOKEN",
  "ACCESS_TOKENS",
  "A2A_SECRET",
  "AGENT_PROD_CODE_EXECUTION",
  "AGENT_NATIVE_SSR_CACHE",
  "ANTHROPIC_API_KEY",
  "APP_BASE_PATH",
  "APP_ID",
  "APP_NAME",
  "APP_TEMPLATE",
  "APP_URL",
  "AUTH_DISABLED",
  "AUTH_MAGIC_LINK",
  "AUTH_MODE",
  "AUTH_SKIP_EMAIL_VERIFICATION",
  "BRAVE_SEARCH_API_KEY",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CI",
  "COHERE_API_KEY",
  "COOKIE_DOMAIN",
  "CORS_ALLOWED_ORIGINS",
  "DATABASE_AUTH_TOKEN",
  "DATABASE_URL",
  "DEBUG",
  "EMAIL_AGENT_ADDRESS",
  "EMAIL_FROM",
  "EMAIL_INBOUND_WEBHOOK_SECRET",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AUTH_MODE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_LEGACY_CLIENT_ID",
  "GOOGLE_LEGACY_CLIENT_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "NODE_ENV",
  "NITRO_PRESET",
  "OAUTH_STATE_SECRET",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENROUTER_API_KEY",
  "PORT",
  "RESEND_API_KEY",
  "SECRETS_ENCRYPTION_KEY",
  "SENDGRID_API_KEY",
  "TAVILY_API_KEY",
  "WEBHOOK_BASE_URL",
  "WORKSPACE_SECRETS_ENCRYPTION_KEY",
  "WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const ENV_EXAMPLE_PATTERN = /(?:^|\/)\.env(?:\.[^/]+)?\.example$/;
const TEST_FILE_PATTERN = /\.(?:spec|test)\.[tj]sx?$|\/__tests__\//;

const files = repositoryFiles();
const inventoryPatterns = readDocumentedPatterns(INVENTORY_DOCUMENTATION_PATH);
const publicPatterns = readDocumentedPatterns(PUBLIC_DOCUMENTATION_PATH);
const references = new Map<string, Set<string>>();

for (const relativePath of files) {
  if (!shouldScan(relativePath)) continue;

  const fullPath = path.join(REPO_ROOT, relativePath);
  let source: string;
  try {
    source = readFileSync(fullPath, "utf8");
  } catch {
    continue;
  }

  const keys = new Set<string>();
  if (ENV_EXAMPLE_PATTERN.test(relativePath)) {
    for (const match of source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
      keys.add(match[1]);
    }
  }

  if (path.extname(relativePath) === ".toml") {
    collectMatches(source, /^([A-Z][A-Z0-9_]*)\s*=/gm, keys);
  }

  if (/\.ya?ml$/.test(relativePath)) {
    collectMatches(source, /^\s*([A-Z][A-Z0-9_]*)\s*:/gm, keys);
  }

  collectMatches(source, /process\.env\.([A-Z][A-Z0-9_]*)/g, keys);
  collectMatches(
    source,
    /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    keys,
  );
  collectMatches(source, /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g, keys);
  collectMatches(source, /\b(?:secrets|vars)\.([A-Z][A-Z0-9_]*)/g, keys);
  collectMatches(source, /Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g, keys);
  collectMatches(source, /Bun\.env\.([A-Z][A-Z0-9_]*)/g, keys);

  if (isEnvironmentManifest(relativePath)) {
    collectMatches(
      source,
      /\b(?:envVar|inputKey|key|credentialKey|baseUrlCredentialKey|usernameKey|passwordKey|tokenKey|clientIdKey|clientSecretKey|secretKey|publicKey):\s*["']([A-Z][A-Z0-9_]*)["']/g,
      keys,
    );
    for (const match of source.matchAll(
      /\b(?:envKeys|credentialKeys|requiredKeys|fallbackKeys|keys)\s*:\s*\[([\s\S]*?)\]/g,
    )) {
      collectMatches(match[1], /["']([A-Z][A-Z0-9_]*)["']/g, keys);
    }
  }

  collectDeclaredEnvironmentKeys(source, keys);

  if (isDynamicEnvironmentManifest(relativePath)) {
    collectMatches(source, /["']([A-Z][A-Z0-9_]*_[A-Z0-9_]+)["']/g, keys);
  }

  if (isDeployCredentialRegistry(relativePath)) {
    for (const match of source.matchAll(
      /APP_PROVIDED_DEPLOY_CREDENTIAL_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/g,
    )) {
      collectMatches(match[1], /["']([A-Z][A-Z0-9_]*)["']/g, keys);
    }
  }

  collectMatches(
    source,
    /\b(?:processEnv|readDeployCredentialEnv|readEnvValue|getEnvValue|envString|envValue|resolveApiKey)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    keys,
  );

  for (const key of keys) {
    const locations = references.get(key) ?? new Set<string>();
    locations.add(relativePath);
    references.set(key, locations);
  }
}

if (process.argv.includes("--list")) {
  for (const [key, locations] of [...references.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`${key}\t${[...locations].sort().join(",")}`);
  }
  process.exit(0);
}

const missingInventory = [...references.keys()]
  .filter((key) => !isDocumented(key, inventoryPatterns))
  .map((key) => ({ docPath: INVENTORY_DOCUMENTATION_PATH, key }));

const missingPublic = [...references.keys()]
  .filter((key) => isPublicHardCodedKey(key))
  .filter((key) => !isDocumented(key, publicPatterns))
  .map((key) => ({ docPath: PUBLIC_DOCUMENTATION_PATH, key }));

const publicWildcardPatterns = [...publicPatterns].filter((pattern) =>
  pattern.includes("*"),
);

const missing = [...missingInventory, ...missingPublic].sort(
  (a, b) => a.key.localeCompare(b.key) || a.docPath.localeCompare(b.docPath),
);

if (publicWildcardPatterns.length > 0 || missing.length > 0) {
  if (publicWildcardPatterns.length > 0) {
    console.error(
      `[env-doc] Public documentation must use exact environment-variable names; wildcard pattern(s) found: ${publicWildcardPatterns.join(", ")}`,
    );
  }

  if (missing.length === 0) process.exit(1);

  console.error(
    `[env-doc] ${missing.length} documentation gap(s) found in the environment-variable references:`,
  );
  for (const { docPath, key } of missing) {
    const locations = [...(references.get(key) ?? [])].slice(0, 3).join(", ");
    console.error(
      `  - ${key} missing from ${path.relative(REPO_ROOT, docPath)} (${locations})`,
    );
  }
  process.exit(1);
}

const inventoryPatternCount = inventoryPatterns.size;
const publicPatternCount = publicPatterns.size;
console.log(
  `[env-doc] Covered ${references.size} static environment variables in the maintainer inventory and curated framework docs (${inventoryPatternCount} inventory entries, ${publicPatternCount} public entries).`,
);

function repositoryFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
}

function shouldScan(relativePath: string): boolean {
  if (relativePath === "docs/environment-variables.md") return false;
  if (relativePath.startsWith(".claude/")) return false;
  if (relativePath.startsWith(".agents/")) return false;
  if (relativePath.startsWith("skills/")) return false;
  if (relativePath.includes("/skills/")) return false;
  if (relativePath.startsWith("plans/")) return false;
  if (relativePath.includes("/plans/")) return false;
  if (relativePath.startsWith("docs/")) return false;
  if (relativePath.includes("/docs/")) return false;
  if (relativePath.includes("/corpus/")) return false;
  if (relativePath.includes("/changelog/")) return false;
  if (relativePath.includes("/public/assets/generated/")) return false;
  if (relativePath.startsWith("packages/core/src/guards/")) return false;
  if (/(?:^|\/)guard-[^/]+\.(?:mjs|ts)$/.test(relativePath)) return false;
  if (TEST_FILE_PATTERN.test(relativePath)) return false;
  if (relativePath.startsWith("node_modules/")) return false;

  if (ENV_EXAMPLE_PATTERN.test(relativePath)) return true;
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function isEnvironmentManifest(relativePath: string): boolean {
  return (
    /(?:^|\/)env-config\.ts$/.test(relativePath) ||
    /(?:^|\/)provider-env-vars\.ts$/.test(relativePath) ||
    /(?:^|\/)data-sources\.ts$/.test(relativePath) ||
    /(?:^|\/)register-framework-secrets\.ts$/.test(relativePath) ||
    /(?:^|\/)core-routes\.ts$/.test(relativePath) ||
    /(?:^|\/)onboarding\/default-steps\.ts$/.test(relativePath)
  );
}

function isDynamicEnvironmentManifest(relativePath: string): boolean {
  return /(?:^|\/)google-oauth-credentials\.ts$/.test(relativePath);
}

function isDeployCredentialRegistry(relativePath: string): boolean {
  return /(?:^|\/)credential-provider\.ts$/.test(relativePath);
}

function collectDeclaredEnvironmentKeys(source: string, keys: Set<string>) {
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*ENV[A-Za-z0-9_$]*\s*=\s*["']([A-Z][A-Z0-9_]*_[A-Z0-9_]*)["']/g,
  )) {
    keys.add(match[1]);
  }

  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*ENV[A-Za-z0-9_$]*\s*=\s*\[([\s\S]*?)\]/g,
  )) {
    collectMatches(match[1], /["']([A-Z][A-Z0-9_]*_[A-Z0-9_]*)["']/g, keys);
  }
}

function collectMatches(source: string, pattern: RegExp, keys: Set<string>) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const lineEnd = source.indexOf("\n", lineStart);
    const line = source.slice(
      lineStart,
      lineEnd === -1 ? source.length : lineEnd,
    );
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
    keys.add(match[1]);
  }
}

function readDocumentedPatterns(docPath: string): Set<string> {
  const patterns = new Set<string>();
  const source = readFileSync(docPath, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const match of source.matchAll(/`([^`]+)`/g)) {
    const candidate = match[1];
    if (/^[A-Z][A-Z0-9_]*\*?$/.test(candidate)) patterns.add(candidate);
    if (/^\*_[A-Z][A-Z0-9_*]*$/.test(candidate)) patterns.add(candidate);
  }
  return patterns;
}

function isPublicHardCodedKey(key: string): boolean {
  return PUBLIC_EXACT_KEYS.has(key);
}

function isDocumented(key: string, patterns: Set<string>): boolean {
  for (const pattern of patterns) {
    if (pattern === key) return true;
    if (!pattern.includes("*")) continue;
    const expression = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    if (expression.test(key)) return true;
  }
  return false;
}
