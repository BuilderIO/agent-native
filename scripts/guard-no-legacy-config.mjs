#!/usr/bin/env node
/**
 * guard-no-legacy-config.mjs
 *
 * Consumer code in `packages/core` does not read `process.env`. Exactly four
 * resolvers do, and everything else goes through `getAppConfig()`:
 *
 *   - the app-config env layer  — product behavior, via `.meta({ env })`
 *   - resolveDeployEnvironment  — platform facts (NODE_ENV, NETLIFY, AWS_*)
 *   - readDeployCredentialEnv   — secrets, inside scoped resolution
 *   - getAmbientUserEmail/OrgId — CLI identity with no request context
 *
 * Why a guard and not just the `configuration` skill: core reached 301 distinct
 * environment variables, of which only 48 were secrets. Every one of the other
 * 253 was added by someone who, at that call site, had nothing else reachable.
 * Guidance does not help at the moment of temptation; a declared field does,
 * and this is what points at it.
 *
 * Two rules, on lines THIS branch adds (scripts/lib/changed-lines.mjs), so the
 * existing backlog stays a separate cleanup and nobody is forced into a
 * migration by a guard:
 *
 *   1. `process.env.X` in packages/core/src — unless the file is one of the
 *      four resolvers, or X is a platform fact the app never sets.
 *   2. A call to a replaced entry point on the deprecation register.
 *
 * Opt out per line with a reason a reviewer can weigh:
 *
 *   process.env.SOMETHING // config-ok: <reason>
 *
 * on the same line or in the comment block immediately above.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SCOPE = path.join("packages", "core", "src");
const TEST_FILE_RE = /\.(spec|test)\.tsx?$/;
const TS_FILE_RE = /\.tsx?$/;
const PRAGMA_RE = /\/\/\s*config-ok:/i;

/**
 * The four resolvers, plus the places that legitimately compose an environment
 * for something else (a child process, a generated worker bundle, a deploy
 * target). These own env reading; everything else consumes their output.
 */
const RESOLVER_FILES = [
  "app-config/env-layer.ts",
  "app-config/store.ts",
  "server/deploy-environment.ts",
  "server/credential-provider.ts",
  "server/request-context.ts",
  // Build/deploy tooling composes env for a child, rather than reading config.
  "deploy/",
  "vite/",
  "cli/",
  "scripts/",
];

/**
 * Platform facts: set by the host, never by an app. These are not app
 * configuration, so they do not belong in the schema and reading them is fine.
 */
const PLATFORM_KEYS = new Set([
  "NODE_ENV",
  "PORT",
  "CI",
  "HOME",
  "PATH",
  "TMPDIR",
  "TZ",
  "NETLIFY",
  "NETLIFY_LOCAL",
  "NETLIFY_DEV",
  "SITE_ID",
  "SITE_NAME",
  "URL",
  "DEPLOY_URL",
  "DEPLOY_PRIME_URL",
  "CONTEXT",
  "BRANCH",
  "HEAD",
  "COMMIT_REF",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "CF_PAGES",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
  "AWS_REGION",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "LAMBDA_TASK_ROOT",
]);

const PLATFORM_PREFIXES = ["AWS_", "npm_", "GITHUB_", "VITEST", "NETLIFY_"];

/** Replaced entry points. Deprecated, still exported, must not gain callers. */
const DEPRECATED_CALLS = [
  {
    name: "setPrivateBlobPublicUploadFallbackEnabled",
    replacement: "defineAppConfig({ privateBlob: { publicUploadFallback } })",
  },
];

const ENV_READ_RE =
  /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g;

function isPlatformKey(key) {
  if (PLATFORM_KEYS.has(key)) return true;
  return PLATFORM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isResolverFile(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  const withinScope = normalized.slice(
    `${SCOPE.split(path.sep).join("/")}/`.length,
  );
  return RESOLVER_FILES.some((entry) =>
    entry.endsWith("/") ? withinScope.startsWith(entry) : withinScope === entry,
  );
}

function hasPragma(lines, lineNo) {
  if (PRAGMA_RE.test(lines[lineNo - 1] ?? "")) return true;
  for (let index = lineNo - 2; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line.startsWith("//") && !line.startsWith("*")) return false;
    if (PRAGMA_RE.test(line)) return true;
  }
  return false;
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard-no-legacy-config");
  const violations = [];

  for (const [absPath, lineNumbers] of added) {
    const relPath = path.relative(REPO_ROOT, absPath);
    if (!relPath.startsWith(SCOPE)) continue;
    if (!TS_FILE_RE.test(relPath) || TEST_FILE_RE.test(relPath)) continue;

    let lines;
    try {
      lines = readFileSync(absPath, "utf8").split("\n");
    } catch {
      continue;
    }

    const resolver = isResolverFile(relPath);

    for (const lineNo of lineNumbers) {
      const line = lines[lineNo - 1];
      if (line === undefined) continue;
      const code = line.replace(/\/\/.*$/, "");
      if (hasPragma(lines, lineNo)) continue;

      if (!resolver) {
        ENV_READ_RE.lastIndex = 0;
        let match;
        while ((match = ENV_READ_RE.exec(code)) !== null) {
          const key = match[1] ?? match[2];
          if (!key || isPlatformKey(key)) continue;
          violations.push({
            relPath,
            lineNo,
            message: `reads process.env.${key} — declare it in packages/core/src/app-config and read getAppConfig() instead`,
          });
        }
      }

      for (const { name, replacement } of DEPRECATED_CALLS) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(code)) {
          violations.push({
            relPath,
            lineNo,
            message: `calls deprecated ${name}() — use ${replacement}`,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `guard-no-legacy-config: ${violations.length} violation(s) on lines this branch added.\n`,
    );
    for (const { relPath, lineNo, message } of violations) {
      console.error(`  ${relPath}:${lineNo} ${message}`);
    }
    console.error(
      "\nSee .agents/skills/configuration/SKILL.md. Last resort, with a reason:" +
        "\n  process.env.SOMETHING // config-ok: <why this cannot be a declared field>",
    );
    process.exit(1);
  }

  console.log("guard-no-legacy-config: clean");
}

main();
