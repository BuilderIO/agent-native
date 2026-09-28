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
  packageName: string;
  styleImport: string;
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
  const errors = [
    ...styleResult.errors,
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
    `[guard:modal-layer-integrity] clean (${styleResult.checked} template/package style contract(s); one dismissable-layer resolution)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
