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
    // Keep variant prefixes: `sm:relative` drops `fixed` just as hard.
    const utility = token.slice(token.lastIndexOf(":") + 1);
    if (POSITION_UTILITIES.includes(utility)) return token;
  }
  return null;
}

/**
 * Reads the opening tag of every pinned overlay element and reports a caller
 * className that carries a position utility. Only string literals are
 * inspected; a computed className is not worth a parser here, and the literal
 * form is what every current caller uses.
 */
export function findOverlayPositionOverrides(
  source: string,
  relativePath: string,
): string[] {
  const findings: string[] = [];
  const opening = new RegExp(
    `<(${PINNED_OVERLAY_COMPONENTS.join("|")})(\\s[^>]*?)?/?>`,
    "gs",
  );

  for (const tag of source.matchAll(opening)) {
    const [whole, component, attributes = ""] = tag;
    if (attributes.includes(OVERRIDE_OPT_OUT)) continue;
    for (const literal of attributes.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const offending = hasPositionUtility(literal[1] ?? literal[2] ?? "");
      if (!offending) continue;
      const line = source.slice(0, tag.index).split("\n").length;
      findings.push(
        `${relativePath}:${line} <${component}> receives "${offending}". ` +
          `cn() merges that over the primitive's "fixed", so the overlay leaves the ` +
          `viewport and renders below the page content. Remove the position utility, ` +
          `or add an "${OVERRIDE_OPT_OUT}:" note explaining why this one is safe.`,
      );
      break;
    }
    void whole;
  }

  return findings;
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
      errors.push(...findOverlayPositionOverrides(source, relativePath));
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
