/*
 * Two invariants that both surface as "the screen dims but no dialog appears,
 * and the page stays dead until reload".
 *
 * 1. Tailwind v4 does not scan workspace packages under node_modules. An app
 *    that renders a package's components without importing that package's
 *    `@source` stylesheet silently loses every utility the package uses and
 *    the app does not. Modal content then keeps its static position and lands
 *    below the fold while the full-screen overlay still paints.
 * 2. `@radix-ui/react-dismissable-layer` keeps `originalBodyPointerEvents` and
 *    its open-layer Set in module scope. Two resolved copies cannot see each
 *    other, so an overlapping menu and dialog restore
 *    `document.body { pointer-events: none }` on close and kill the page.
 * 3. Overlay primitives pin themselves with `fixed`, and merge the caller's
 *    `className` through tailwind-merge. A caller that passes any position
 *    utility wins that merge, so the primitive's `fixed` is dropped, the
 *    content falls back into document flow below the page, and the page grows
 *    a scrollbar instead of reporting anything.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SINGLETON_LAYER_PACKAGE = "@radix-ui/react-dismissable-layer";

const GLOBAL_CSS_CANDIDATES = [
  "app/global.css",
  "app/styles.css",
  "src/global.css",
];

export interface StyleSourceContract {
  /** Workspace package that ships Tailwind `@source` directives. */
  packageName: string;
  /** Import specifier an app must add to its global CSS. */
  styleImport: string;
  /** Import prefixes that mean the app renders that package's components. */
  componentImports: string[];
}

export const STYLE_SOURCE_CONTRACTS: StyleSourceContract[] = [
  {
    packageName: "@agent-native/dispatch",
    styleImport: "@agent-native/dispatch/styles/dispatch.css",
    componentImports: [
      "@agent-native/dispatch/components",
      "@agent-native/dispatch/routes",
    ],
  },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

export function checkTemplateStyleSources(
  repoRoot: string,
  contracts: StyleSourceContract[] = STYLE_SOURCE_CONTRACTS,
): { checked: number; errors: string[] } {
  const templatesDir = path.join(repoRoot, "templates");
  if (!existsSync(templatesDir)) return { checked: 0, errors: [] };
  const errors: string[] = [];
  let checked = 0;

  for (const template of readdirSync(templatesDir)) {
    const base = path.join(templatesDir, template);
    if (!statSync(base).isDirectory()) continue;
    const cssPath = GLOBAL_CSS_CANDIDATES.map((c) => path.join(base, c)).find(
      existsSync,
    );
    if (!cssPath) continue;
    const css = readFileSync(cssPath, "utf8");
    const sources = walk(path.join(base, "app")).concat(
      walk(path.join(base, "src")),
    );

    for (const contract of contracts) {
      const rendersPackage = sources.some((file) => {
        const text = readFileSync(file, "utf8");
        return contract.componentImports.some((specifier) =>
          text.includes(specifier),
        );
      });
      if (!rendersPackage) continue;
      checked += 1;
      if (!css.includes(contract.styleImport)) {
        errors.push(
          `templates/${template} renders ${contract.packageName} components but ` +
            `${path.relative(repoRoot, cssPath)} does not import "${contract.styleImport}". ` +
            `Tailwind will not emit that package's utilities, so its dialogs render unpositioned.`,
        );
      }
    }
  }

  return { checked, errors };
}

/** Overlay primitives whose own class string starts with `fixed`. */
const PINNED_OVERLAY_COMPONENTS = [
  "DialogContent",
  "DialogOverlay",
  "AlertDialogContent",
  "AlertDialogOverlay",
  "SheetContent",
  "SheetOverlay",
  "DrawerContent",
  "DrawerOverlay",
];

const POSITION_UTILITIES = ["static", "relative", "absolute", "sticky"];

const OVERRIDE_OPT_OUT = "overlay-position-ok";

const OVERLAY_SCAN_ROOTS = ["templates", "packages", "apps"];

function hasPositionUtility(classValue: string): string | null {
  for (const token of classValue.split(/\s+/)) {
    // Keep variant prefixes: `sm:relative` drops `fixed` just as hard, and
    // `!relative` / `relative!` beat it in the cascade even if the merge keeps
    // both. Five overlay call sites here already use the important modifier.
    const utility = token
      .slice(token.lastIndexOf(":") + 1)
      .replace(/^!/, "")
      .replace(/!$/, "");
    if (POSITION_UTILITIES.includes(utility)) return token;
  }
  return null;
}

/**
 * Returns the opening tag that starts at `<`, or null when it never closes.
 * A regex cannot do this: `onInteractOutside={(event) => event.preventDefault()}`
 * puts a `>` inside the attribute list, so any `[^>]*` pattern ends the tag
 * before reaching `className` - the one attribute this guard exists to read.
 */
function readOpeningTag(source: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    } else if (character === ">" && depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  return null;
}

/**
 * Blanks comment spans so a parked `{/* className="relative" *\/}` is not read
 * as a live attribute. Length is preserved so offsets stay valid, and quotes
 * are tracked so `href="https://..."` is not mistaken for a line comment.
 *
 * `lineComments: "at-line-start"` is for whole-file use. This is not a JS
 * lexer, and an unquoted `//` in JSX body text would otherwise blank the rest
 * of that line - hiding a real call site is worse than the parked example it
 * would catch. A commented-out call site always sits on a line that starts
 * with `//`, so that narrower rule covers it without the risk.
 */
function maskComments(
  tag: string,
  lineComments: "anywhere" | "at-line-start" = "anywhere",
): string {
  const out = tag.split("");
  let quote: string | null = null;

  for (let index = 0; index < tag.length; index += 1) {
    const character = tag[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character !== "/") continue;

    const next = tag[index + 1];
    if (next === "*") {
      const close = tag.indexOf("*/", index + 2);
      const end = close === -1 ? tag.length : close + 2;
      for (let blank = index; blank < end; blank += 1) out[blank] = " ";
      index = end - 1;
      continue;
    }
    if (next === "/") {
      if (lineComments === "at-line-start") {
        const lineStart = tag.lastIndexOf("\n", index) + 1;
        if (tag.slice(lineStart, index).trim() !== "") continue;
      }
      const newline = tag.indexOf("\n", index);
      const end = newline === -1 ? tag.length : newline;
      for (let blank = index; blank < end; blank += 1) out[blank] = " ";
      index = end - 1;
    }
  }

  return out.join("");
}

/**
 * Every string literal a `class`/`className` attribute contributes. Scoped to
 * that attribute on purpose: reading all quoted strings in the tag would fail
 * an honest `aria-label="relative"`.
 */
/**
 * A template literal contributes both its static text and any string literal
 * inside an interpolation, so `` `${wide ? "relative" : ""} max-w-lg` `` is
 * read as `relative` plus `max-w-lg` rather than one opaque blob.
 */
function expandTemplateLiteral(raw: string): string[] {
  if (!raw.includes("${")) return [raw];
  const parts: string[] = [];
  let rest = raw;

  while (rest.length > 0) {
    const open = rest.indexOf("${");
    if (open === -1) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, open));
    let depth = 1;
    let index = open + 2;
    for (; index < rest.length && depth > 0; index += 1) {
      if (rest[index] === "{") depth += 1;
      else if (rest[index] === "}") depth -= 1;
    }
    const expression = rest.slice(open + 2, index - 1);
    for (const nested of expression.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      parts.push(nested[1] ?? nested[2] ?? "");
    }
    rest = rest.slice(index);
  }

  return parts;
}

function classNameLiterals(rawTag: string): string[] {
  const literals: string[] = [];
  const tag = maskComments(rawTag);

  for (const attribute of tag.matchAll(/\bclass(?:Name)?\s*=\s*/g)) {
    const rest = tag.slice(attribute.index + attribute[0].length);
    const opener = rest[0];

    if (opener === '"' || opener === "'") {
      const close = rest.indexOf(opener, 1);
      if (close > 0) literals.push(rest.slice(1, close));
      continue;
    }
    if (opener === "`") {
      const close = rest.indexOf("`", 1);
      if (close > 0)
        literals.push(...expandTemplateLiteral(rest.slice(1, close)));
      continue;
    }
    if (opener !== "{") continue;

    // cn("relative", isWide && "sticky") - any literal in the expression can
    // reach tailwind-merge, so collect them all.
    let depth = 0;
    let quote: string | null = null;
    let literal = "";
    for (let index = 0; index < rest.length; index += 1) {
      const character = rest[index]!;
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) {
          if (quote === "`") literals.push(...expandTemplateLiteral(literal));
          else literals.push(literal);
          quote = null;
        } else literal += character;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        literal = "";
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
  }

  return literals;
}

export interface OverlayScanResult {
  findings: string[];
  /** Overlay tags this scanner could not read, so nothing was inspected. */
  unreadable: string[];
}

export function findOverlayPositionOverrides(
  source: string,
  relativePath: string,
): OverlayScanResult {
  const findings: string[] = [];
  const unreadable: string[] = [];
  const opening = new RegExp(
    `<(${PINNED_OVERLAY_COMPONENTS.join("|")})(?=[\\s/>])`,
    "g",
  );

  const discoverable = maskComments(source, "at-line-start");

  for (const match of discoverable.matchAll(opening)) {
    const component = match[1]!;
    const line = source.slice(0, match.index).split("\n").length;
    const tag = readOpeningTag(source, match.index);
    if (tag === null) {
      unreadable.push(
        `${relativePath}:${line} <${component}> has an opening tag this guard ` +
          `could not read, so nothing was inspected.`,
      );
      continue;
    }
    if (tag.includes(OVERRIDE_OPT_OUT)) continue;

    for (const value of classNameLiterals(tag)) {
      const offending = hasPositionUtility(value);
      if (!offending) continue;
      findings.push(
        `${relativePath}:${line} <${component}> receives "${offending}". ` +
          `cn() merges that over the primitive's "fixed", so the overlay leaves the ` +
          `viewport and renders below the page content. Remove the position utility, ` +
          `or add an "${OVERRIDE_OPT_OUT}:" note explaining why this one is safe.`,
      );
      break;
    }
  }

  return { findings, unreadable };
}

export function checkOverlayPositionOverrides(
  repoRoot: string,
  roots: string[] = OVERLAY_SCAN_ROOTS,
): { checked: number; errors: string[] } {
  const errors: string[] = [];
  let checked = 0;

  for (const root of roots) {
    for (const file of walk(path.join(repoRoot, root))) {
      if (!file.endsWith(".tsx")) continue;
      const relativePath = path.relative(repoRoot, file);
      // The corpus is a build artifact copy of the templates already scanned.
      if (relativePath.includes(`${path.sep}corpus${path.sep}`)) continue;
      const source = readFileSync(file, "utf8");
      if (!PINNED_OVERLAY_COMPONENTS.some((name) => source.includes(name))) {
        continue;
      }
      checked += 1;
      const scan = findOverlayPositionOverrides(source, relativePath);
      errors.push(...scan.findings, ...scan.unreadable);
    }
  }

  return { checked, errors };
}

/**
 * pnpm keys each installed instance by its full `snapshots:` locator, peer
 * suffix included. Two entries of the same published version resolved against
 * different peers are still two directories and therefore two module scopes,
 * so the locator - not the version - is the instance boundary here. The
 * `packages:` section lists each version once and would hide that.
 */
export function findDuplicateLayerResolutions(
  lockfile: string,
  packageName: string = SINGLETON_LAYER_PACKAGE,
): string[] {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const locator = new RegExp(`^ {2}'?(${escaped}@[^':]+)'?:`);
  const locators = new Set<string>();
  let inSnapshots = false;

  for (const line of lockfile.split(/\r?\n/)) {
    if (/^snapshots:/.test(line)) {
      inSnapshots = true;
      continue;
    }
    if (inSnapshots && /^\S/.test(line)) break;
    if (!inSnapshots) continue;
    const match = line.match(locator);
    if (match?.[1]) locators.add(match[1]);
  }

  return [...locators].sort();
}

export function checkLayerSingleton(lockfile: string): string[] {
  const locators = findDuplicateLayerResolutions(lockfile);
  if (locators.length <= 1) return [];
  return [
    `${SINGLETON_LAYER_PACKAGE} resolves to ${locators.length} instances:\n` +
      locators.map((locator) => `    ${locator}`).join("\n") +
      `\n  Each instance tracks open layers and the original body pointer-events in its own ` +
      `module scope, so an overlapping menu and dialog leave document.body non-interactive. ` +
      `Pin one resolution in pnpm.overrides.`,
  ];
}

function main() {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const lockfilePath = path.join(repoRoot, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    console.error(
      "[guard:modal-layer-integrity] could not read pnpm-lock.yaml; nothing was inspected",
    );
    process.exit(2);
  }

  const styleResult = checkTemplateStyleSources(repoRoot);
  const overrideResult = checkOverlayPositionOverrides(repoRoot);
  const errors = [
    ...styleResult.errors,
    ...overrideResult.errors,
    ...checkLayerSingleton(readFileSync(lockfilePath, "utf8")),
  ];

  if (errors.length > 0) {
    console.error(
      `[guard:modal-layer-integrity] ${errors.length} issue(s):\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[guard:modal-layer-integrity] clean (${styleResult.checked} template/package style contract(s); ` +
      `${overrideResult.checked} overlay call site file(s); one dismissable-layer resolution)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
