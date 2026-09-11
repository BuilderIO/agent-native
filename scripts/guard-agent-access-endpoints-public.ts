import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GUARD = "guard:agent-access-endpoints-public";
const TEMPLATES_ROOT = "templates";
const AUTH_PLUGIN = "server/plugins/auth.ts";
const SHAREABLE_REGISTRATIONS = "server/db/index.ts";
const SKIPPED_DIRECTORIES = new Set([
  ".generated",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

// An `agent_access` URL is fetched with no session cookie, so its endpoint must
// be in the template's auth `publicPaths` or the session gate answers 401 before
// the handler can verify the scoped token. Matching by name makes a new endpoint
// constant opt in here instead of shipping unreachable.
const AGENT_ENDPOINT_CONSTANT = /^[A-Z0-9_]*AGENT[A-Z0-9_]*_ENDPOINT$/;

export type RequiredEndpoint = {
  endpoint: string;
  source: string;
};

export type EndpointResolution = {
  required: RequiredEndpoint[];
  unresolvedContextPaths: string[];
};

export type PublicPathResolution = {
  paths: string[];
  unresolvedMembers: string[];
};

export type TemplateVerdict = {
  template: string;
  missing: RequiredEndpoint[];
  undecidable: string[];
};

function stringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /export const ([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*"([^"]*)"/g;
  for (const match of source.matchAll(pattern)) {
    constants.set(match[1] as string, match[2] as string);
  }
  return constants;
}

function arrayConstants(source: string): Map<string, string[]> {
  const constants = new Map<string, string[]>();
  const pattern = /export const ([A-Za-z0-9_$]+)\s*(?::[^=]+)?=([\s\S]*?);\n/g;
  for (const match of source.matchAll(pattern)) {
    const initializer = match[2] ?? "";
    if (!initializer.includes("[")) continue;
    constants.set(
      match[1] as string,
      [...initializer.matchAll(/"([^"]*)"/g)].map(
        (literal) => literal[1] as string,
      ),
    );
  }
  return constants;
}

export function collectRequiredEndpoints(
  files: Map<string, string>,
): EndpointResolution {
  const required = new Map<string, string>();
  const unresolvedContextPaths: string[] = [];
  const constants = new Map<string, string>();

  for (const [file, source] of files) {
    for (const [name, value] of stringConstants(source)) {
      constants.set(name, value);
      if (AGENT_ENDPOINT_CONSTANT.test(name) && value.startsWith("/api/")) {
        required.set(value, `${file} (${name})`);
      }
    }
  }

  // The framework mints the share-dialog link from this registration, so an
  // endpoint named outside the constant convention above still has to be public.
  const registrations = files.get(SHAREABLE_REGISTRATIONS);
  if (registrations) {
    const pattern =
      /getContextPath:\s*\([^)]*\)\s*=>\s*("([^"]*)"|[A-Za-z0-9_$.]+)/g;
    for (const match of registrations.matchAll(pattern)) {
      const literal = match[2];
      if (literal) {
        required.set(literal, `${SHAREABLE_REGISTRATIONS} (getContextPath)`);
        continue;
      }
      const expression = (match[1] ?? "").trim();
      const resolved = constants.get(expression);
      if (resolved) {
        required.set(
          resolved,
          `${SHAREABLE_REGISTRATIONS} (getContextPath: ${expression})`,
        );
        continue;
      }
      unresolvedContextPaths.push(expression);
    }
  }

  return {
    required: [...required].map(([endpoint, source]) => ({ endpoint, source })),
    unresolvedContextPaths,
  };
}

/** Comments carry commas, so they have to go before the array is split. */
export function stripComments(source: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor] as string;
    if (character === '"' || character === "'" || character === "`") {
      const closed = source.indexOf(character, cursor + 1);
      const end = closed === -1 ? source.length : closed + 1;
      output += source.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (source.startsWith("//", cursor)) {
      const lineEnd = source.indexOf("\n", cursor);
      cursor = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const blockEnd = source.indexOf("*/", cursor + 2);
      cursor = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }
    output += character;
    cursor += 1;
  }
  return output;
}

export function extractPublicPathsArray(source: string): string | null {
  const start = source.indexOf("publicPaths:");
  if (start < 0) return null;
  const open = source.indexOf("[", start);
  if (open < 0) return null;
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, cursor);
    }
  }
  return null;
}

export function resolvePublicPaths(
  files: Map<string, string>,
): PublicPathResolution | null {
  const authPlugin = files.get(AUTH_PLUGIN);
  if (!authPlugin) return null;
  const members = extractPublicPathsArray(authPlugin);
  if (members === null) return { paths: [], unresolvedMembers: [] };

  const strings = new Map<string, string>();
  const arrays = new Map<string, string[]>();
  for (const source of files.values()) {
    for (const [name, value] of stringConstants(source))
      strings.set(name, value);
    for (const [name, value] of arrayConstants(source)) arrays.set(name, value);
  }

  const paths: string[] = [];
  const unresolvedMembers: string[] = [];
  for (const raw of stripComments(members).split(",")) {
    const member = raw.trim();
    if (!member) continue;
    const literal = member.match(/^"([^"]*)"$/);
    if (literal) {
      paths.push(literal[1] as string);
      continue;
    }
    const identifier = member.replace(/^\.\.\./, "");
    const asString = strings.get(identifier);
    if (asString !== undefined) {
      paths.push(asString);
      continue;
    }
    const asArray = arrays.get(identifier);
    if (asArray !== undefined) {
      paths.push(...asArray);
      continue;
    }
    unresolvedMembers.push(member);
  }

  return { paths, unresolvedMembers };
}

/** Mirrors the auth guard's own prefix matching (`matchesPathList`). */
export function isCoveredByPublicPaths(
  endpoint: string,
  publicPaths: string[],
): boolean {
  return publicPaths.some((candidate) => {
    const normalized =
      candidate.length > 1 && candidate.endsWith("/")
        ? candidate.slice(0, -1)
        : candidate;
    return endpoint === normalized || endpoint.startsWith(`${normalized}/`);
  });
}

export function auditTemplate(
  template: string,
  files: Map<string, string>,
): TemplateVerdict {
  const { required, unresolvedContextPaths } = collectRequiredEndpoints(files);
  const undecidable = unresolvedContextPaths.map(
    (expression) =>
      `${SHAREABLE_REGISTRATIONS} getContextPath returns \`${expression}\`, which this guard cannot resolve to a path`,
  );
  if (required.length === 0) {
    return { template, missing: [], undecidable };
  }

  const publicPaths = resolvePublicPaths(files);
  if (!publicPaths) {
    return {
      template,
      missing: [],
      undecidable: [
        ...undecidable,
        `defines agent access endpoints but has no ${AUTH_PLUGIN} to inspect`,
      ],
    };
  }

  const missing = required.filter(
    (item) => !isCoveredByPublicPaths(item.endpoint, publicPaths.paths),
  );
  if (missing.length > 0 && publicPaths.unresolvedMembers.length > 0) {
    return {
      template,
      missing: [],
      undecidable: [
        ...undecidable,
        `${AUTH_PLUGIN} has publicPaths entries this guard cannot resolve (${publicPaths.unresolvedMembers.join(", ")}), so coverage of ${missing
          .map((item) => item.endpoint)
          .join(", ")} cannot be decided`,
      ],
    };
  }

  return { template, missing, undecidable };
}

function readTemplateFiles(templateDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(path.join(absolute, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(?:spec|test)\.tsx?$/.test(entry.name)) continue;
      const absoluteFile = path.join(absolute, entry.name);
      files.set(
        path.relative(templateDir, absoluteFile).split(path.sep).join("/"),
        readFileSync(absoluteFile, "utf8"),
      );
    }
  };
  visit(templateDir);
  return files;
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const templatesRoot = path.join(repoRoot, TEMPLATES_ROOT);
  if (!existsSync(templatesRoot)) {
    console.error(`[${GUARD}] cannot run: ${TEMPLATES_ROOT}/ is missing`);
    process.exitCode = 2;
    return;
  }

  const verdicts = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      auditTemplate(
        entry.name,
        readTemplateFiles(path.join(templatesRoot, entry.name)),
      ),
    );

  const undecidable = verdicts.filter(
    (verdict) => verdict.undecidable.length > 0,
  );
  if (undecidable.length > 0) {
    console.error(
      `[${GUARD}] cannot run:\n${undecidable
        .flatMap((verdict) =>
          verdict.undecidable.map(
            (reason) => `- ${verdict.template}: ${reason}`,
          ),
        )
        .join("\n")}`,
    );
    process.exitCode = 2;
    return;
  }

  const missing = verdicts.filter((verdict) => verdict.missing.length > 0);
  if (missing.length > 0) {
    console.error(
      `[${GUARD}] ${missing.reduce((total, verdict) => total + verdict.missing.length, 0)} endpoint(s) an external agent cannot reach:\n${missing
        .flatMap((verdict) =>
          verdict.missing.map(
            (item) =>
              `- ${verdict.template}: ${item.endpoint} is minted as an agent_access URL in ${item.source} but is not in ${AUTH_PLUGIN} publicPaths, so the session gate answers 401 before the handler verifies the token.`,
          ),
        )
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[${GUARD}] clean (${verdicts.length} templates)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
