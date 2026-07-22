/**
 * Phase 1 checks for the TEMPLATE STANDARD manifest (see manifest.ts).
 *
 * Every function here is read-only: it inspects templates/* and returns
 * Violation[] describing gaps. Nothing here writes to a template. Writing
 * (for the byte-synced surfaces only) lives in sync.ts and is never called
 * from the `--check` path.
 */
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";

import {
  AGENT_NATIVE_WORKSPACE_RANGE,
  AUTH_MIDDLEWARE_REL,
  AUTH_MIDDLEWARE_REQUIRED_IMPORT,
  BYTE_SYNCED_FILES,
  REQUIRED_PACKAGE_SCRIPTS,
  SSR_ROUTE_REL,
  SSR_ROUTE_REQUIRED_IMPORT,
  TEMPLATE_PLACEHOLDER_PATTERN,
  TSCONFIG_EXTENDS,
  VERSION_BAND_PACKAGES,
  VITE_CONFIG_REL,
  VITE_PORT_PATTERN,
  templatePath,
} from "./manifest.ts";

export type Severity = "fail" | "warn";

export type Violation = {
  rule: string;
  template: string;
  severity: Severity;
  message: string;
};

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

// --- (a) BYTE-SYNCED --------------------------------------------------------

export function checkByteSyncedFiles(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const surface of BYTE_SYNCED_FILES) {
    const canonical = readFileSync(surface.canonicalPath, "utf-8");
    for (const template of templates) {
      const path = templatePath(template, surface.relPath);
      const actual = readIfExists(path);
      if (actual === undefined) {
        violations.push({
          rule: `byte-sync:${surface.rule}:missing`,
          template,
          severity: "fail",
          message: `templates/${template}/${surface.relPath} is missing. ${surface.description}`,
        });
        continue;
      }
      if (actual !== canonical) {
        violations.push({
          rule: `byte-sync:${surface.rule}:mismatch`,
          template,
          severity: "fail",
          message: `templates/${template}/${surface.relPath} content differs from the canonical copy (${surface.canonicalPath}).`,
        });
      }
    }
  }
  return violations;
}

// --- (b) STRUCTURALLY CHECKED ----------------------------------------------

export function packageScriptViolationMessage(
  template: string,
  key: string,
  value: string | undefined,
): string | null {
  if (value === undefined) {
    return `templates/${template}/package.json is missing a "${key}" script.`;
  }
  const pattern = REQUIRED_PACKAGE_SCRIPTS[key];
  if (!pattern.test(value)) {
    return `templates/${template}/package.json "${key}" script ("${value}") does not resolve through the expected agent-native CLI/vitest shape.`;
  }
  return null;
}

export function checkPackageScripts(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const pkgPath = templatePath(template, "package.json");
    const raw = readIfExists(pkgPath);
    if (!raw) {
      violations.push({
        rule: "package-json:missing",
        template,
        severity: "fail",
        message: `templates/${template}/package.json is missing.`,
      });
      continue;
    }
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    for (const key of Object.keys(REQUIRED_PACKAGE_SCRIPTS)) {
      const message = packageScriptViolationMessage(template, key, scripts[key]);
      if (message) {
        violations.push({
          rule: `pkg-script:${key}`,
          template,
          severity: "fail",
          message,
        });
      }
    }
  }
  return violations;
}

/**
 * tsconfig.json files are JSONC (TypeScript tolerates `//` comments in them,
 * and templates/plan/tsconfig.json uses one), so this extracts "extends" with
 * a regex instead of JSON.parse rather than writing a comment-stripping JSON
 * parser for a single field.
 */
export function extractTsconfigExtends(raw: string): string | undefined {
  return raw.match(/"extends"\s*:\s*"([^"]*)"/)?.[1];
}

export function checkTsconfigExtends(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const path = templatePath(template, "tsconfig.json");
    const raw = readIfExists(path);
    if (!raw) {
      violations.push({
        rule: "tsconfig-extends",
        template,
        severity: "fail",
        message: `templates/${template}/tsconfig.json is missing.`,
      });
      continue;
    }
    const extendsValue = extractTsconfigExtends(raw);
    if (extendsValue !== TSCONFIG_EXTENDS) {
      violations.push({
        rule: "tsconfig-extends",
        template,
        severity: "fail",
        message: `templates/${template}/tsconfig.json must set "extends": "${TSCONFIG_EXTENDS}" (found ${extendsValue ? JSON.stringify(extendsValue) : "no extends field"}).`,
      });
    }
  }
  return violations;
}

export function checkAuthMiddleware(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const path = templatePath(template, AUTH_MIDDLEWARE_REL);
    const content = readIfExists(path);
    if (content === undefined) {
      violations.push({
        rule: "auth-middleware",
        template,
        severity: "fail",
        message: `templates/${template}/${AUTH_MIDDLEWARE_REL} is missing.`,
      });
      continue;
    }
    if (!content.includes(AUTH_MIDDLEWARE_REQUIRED_IMPORT)) {
      violations.push({
        rule: "auth-middleware",
        template,
        severity: "fail",
        message: `templates/${template}/${AUTH_MIDDLEWARE_REL} does not import ${AUTH_MIDDLEWARE_REQUIRED_IMPORT}.`,
      });
    }
  }
  return violations;
}

export function checkSsrRouteHandler(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const path = templatePath(template, SSR_ROUTE_REL);
    const content = readIfExists(path);
    if (content === undefined) {
      violations.push({
        rule: "ssr-route-handler",
        template,
        severity: "fail",
        message: `templates/${template}/${SSR_ROUTE_REL} is missing.`,
      });
      continue;
    }
    if (!content.includes(SSR_ROUTE_REQUIRED_IMPORT)) {
      violations.push({
        rule: "ssr-route-handler",
        template,
        severity: "fail",
        message: `templates/${template}/${SSR_ROUTE_REL} does not import ${SSR_ROUTE_REQUIRED_IMPORT}.`,
      });
    }
  }
  return violations;
}

export function checkClaudeMdSymlink(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const path = templatePath(template, "CLAUDE.md");
    if (!existsSync(path)) {
      violations.push({
        rule: "claude-md-symlink",
        template,
        severity: "fail",
        message: `templates/${template}/CLAUDE.md is missing (expected a symlink to AGENTS.md).`,
      });
      continue;
    }
    if (!lstatSync(path).isSymbolicLink()) {
      violations.push({
        rule: "claude-md-symlink",
        template,
        severity: "fail",
        message: `templates/${template}/CLAUDE.md exists but is not a symlink to AGENTS.md.`,
      });
      continue;
    }
    const target = readlinkSync(path);
    if (target !== "AGENTS.md") {
      violations.push({
        rule: "claude-md-symlink",
        template,
        severity: "fail",
        message: `templates/${template}/CLAUDE.md symlinks to "${target}", expected "AGENTS.md".`,
      });
    }
  }
  return violations;
}

export function hasUnrenderedPlaceholder(content: string): boolean {
  return TEMPLATE_PLACEHOLDER_PATTERN.test(content);
}

export function checkAgentsMdPlaceholders(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const path = templatePath(template, "AGENTS.md");
    const content = readIfExists(path);
    if (content === undefined) {
      violations.push({
        rule: "agents-md-placeholder",
        template,
        severity: "fail",
        message: `templates/${template}/AGENTS.md is missing.`,
      });
      continue;
    }
    const match = content.match(TEMPLATE_PLACEHOLDER_PATTERN);
    if (match) {
      violations.push({
        rule: "agents-md-placeholder",
        template,
        severity: "fail",
        message: `templates/${template}/AGENTS.md still contains an unrendered placeholder (${match[0]}).`,
      });
    }
  }
  return violations;
}

export function checkVitePortMatch(
  templates: string[],
  devPorts: Record<string, number>,
): Violation[] {
  const violations: Violation[] = [];
  for (const template of templates) {
    const path = templatePath(template, VITE_CONFIG_REL);
    const content = readIfExists(path);
    if (content === undefined) continue;
    const match = content.match(VITE_PORT_PATTERN);
    if (!match) continue;
    const hardcodedPort = Number(match[1]);
    const expectedPort = devPorts[template];
    if (expectedPort !== undefined && hardcodedPort !== expectedPort) {
      violations.push({
        rule: "vite-dev-port",
        template,
        severity: "fail",
        message: `templates/${template}/vite.config.ts hardcodes port ${hardcodedPort}, but packages/shared-app-config/templates.ts declares devPort ${expectedPort}.`,
      });
    }
  }
  return violations;
}

// --- Dependency version bands (WARN-level only) ----------------------------

/** Returns the most common value in `values`, or undefined if the list is empty. */
export function computeMajorityValue(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let bestValue: string | undefined;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

type TemplateDeps = Record<string, string>;

function readDependencies(template: string): TemplateDeps {
  const raw = readIfExists(templatePath(template, "package.json"));
  if (!raw) return {};
  const pkg = JSON.parse(raw) as {
    dependencies?: TemplateDeps;
    devDependencies?: TemplateDeps;
  };
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

export function checkDependencyBands(templates: string[]): Violation[] {
  const violations: Violation[] = [];
  const depsByTemplate = new Map(
    templates.map((template) => [template, readDependencies(template)]),
  );

  for (const [template, deps] of depsByTemplate) {
    for (const [name, range] of Object.entries(deps)) {
      if (name.startsWith("@agent-native/") && range !== AGENT_NATIVE_WORKSPACE_RANGE) {
        violations.push({
          rule: "dep-workspace-range",
          template,
          severity: "warn",
          message: `templates/${template}/package.json depends on ${name}@"${range}"; first-party packages are expected to use "${AGENT_NATIVE_WORKSPACE_RANGE}".`,
        });
      }
    }
  }

  for (const packageName of VERSION_BAND_PACKAGES) {
    const present = [...depsByTemplate.entries()]
      .map(([template, deps]) => [template, deps[packageName]] as const)
      .filter((entry): entry is [string, string] => entry[1] !== undefined);
    const majority = computeMajorityValue(present.map(([, range]) => range));
    if (!majority) continue;
    for (const [template, range] of present) {
      if (range !== majority) {
        violations.push({
          rule: `dep-version-band:${packageName}`,
          template,
          severity: "warn",
          message: `templates/${template}/package.json uses ${packageName}@"${range}"; the majority of templates use "${majority}".`,
        });
      }
    }
  }

  return violations;
}

// --- Aggregation -------------------------------------------------------------

export function runAllChecks(
  templates: string[],
  devPorts: Record<string, number>,
): Violation[] {
  return [
    ...checkByteSyncedFiles(templates),
    ...checkPackageScripts(templates),
    ...checkTsconfigExtends(templates),
    ...checkAuthMiddleware(templates),
    ...checkSsrRouteHandler(templates),
    ...checkClaudeMdSymlink(templates),
    ...checkAgentsMdPlaceholders(templates),
    ...checkVitePortMatch(templates, devPorts),
    ...checkDependencyBands(templates),
  ];
}
