import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/**
 * Where each app gets each component: from the design system, from an older
 * source (Radix, cmdk, sonner, vaul, a shadcn file in toolkit/ui or a local
 * wrapper), or hand-built from raw elements and ARIA roles.
 */
export type Usage = "native" | "legacy" | "custom";

export interface Site {
  file: string;
  detail: string;
}

export type Cell = Record<Usage, Site[]>;

export interface SourceRoot {
  /** A directory scanned, relative to the repo root. */
  dir: string;
  /** Where `@/` points for files under it, relative to the repo root. */
  alias: string | null;
}

export interface AppSource {
  id: string;
  label: string;
  roots: SourceRoot[];
  /** Directories under those roots that hold UI modules rather than app code. */
  uiDirs: string[];
}

export interface Unresolved {
  app: string;
  file: string;
  specifier: string;
}

export interface MigrationStatus {
  apps: { id: string; label: string; files: number }[];
  /** By app id, then part name; a part the app never uses has no cell. */
  cells: Partial<Record<string, Partial<Record<string, Cell>>>>;
  unresolved: Unresolved[];
}

const TOOLKIT_UI = "packages/toolkit/src/ui";
const TOOLKIT_ROOT = "packages/toolkit/src/index.ts";
const SYSTEM_DIR = `${TOOLKIT_UI}/base-ui`;

const ALIASES: Readonly<Record<string, string>> = {
  "dropdown-menu": "menu",
  "hover-card": "preview-card",
  sonner: "toast",
  toaster: "toast",
  "use-toast": "toast",
  command: "autocomplete",
  cmdk: "autocomplete",
  label: "field",
  "input-otp": "otp-field",
  sheet: "drawer",
  vaul: "drawer",
  "input-group": "input",
  textarea: "text-area",
  alert: "callout",
  calendar: "date-picker",
  "react-day-picker": "date-picker",
  empty: "empty-state",
  "filter-trigger": "filter-bar",
};

const UTILITIES = new Set([
  "dismiss",
  "focus-return",
  "icon-only",
  "modal-layer",
  "part-class",
  "pointer-lock",
  "positioning",
  "toolkit-provider",
  "utils",
]);

const LEGACY_PACKAGES = new Set([
  "cmdk",
  "sonner",
  "vaul",
  "input-otp",
  "react-day-picker",
]);

const INPUT_TYPES: Readonly<Record<string, string | null>> = {
  checkbox: "checkbox",
  radio: "radio-group",
  range: "slider",
  number: "number-field",
  file: null,
  hidden: null,
  color: null,
};

const TAGS: Readonly<Record<string, string>> = {
  button: "button",
  select: "select",
  textarea: "text-area",
  dialog: "dialog",
  details: "collapsible",
  progress: "progress",
  meter: "meter",
};

const ROLES: Readonly<Record<string, string>> = {
  slider: "slider",
  tablist: "tabs",
  menu: "menu",
  menubar: "menubar",
  listbox: "select",
  combobox: "combobox",
  radiogroup: "radio-group",
  dialog: "dialog",
  alertdialog: "alert-dialog",
  switch: "switch",
  tooltip: "tooltip",
  toolbar: "toolbar",
  progressbar: "progress",
  meter: "meter",
  checkbox: "checkbox",
};

export function partName(name: string): string {
  return ALIASES[name] ?? name;
}

const kebab = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const SOURCE = /\.(tsx?|jsx?)$/;
const SKIP =
  /(\.(spec|test|stories)\.[jt]sx?$|\.d\.ts$|\/(test-support|__tests__|__mocks__|node_modules|dist)\/)/;

function listSources(repo: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(repo, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP.test(`${child}/`)) walk(child);
      } else if (SOURCE.test(entry.name) && !SKIP.test(child)) {
        out.push(child);
      }
    }
  };
  if (fs.existsSync(path.join(repo, dir))) walk(dir);
  return out.sort();
}

interface ModuleRef {
  specifier: string;
  names: string[];
  typeOnly: boolean;
}

interface Parsed {
  refs: ModuleRef[];
  declares: Set<string>;
  reexports: { specifier: string; names: [string, string][] | "*" }[];
  custom: Map<string, string[]>;
}

function parse(file: string, text: string): Parsed {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const parsed: Parsed = {
    refs: [],
    declares: new Set(),
    reexports: [],
    custom: new Map(),
  };
  const addCustom = (part: string, detail: string) => {
    const list = parsed.custom.get(part) ?? [];
    list.push(detail);
    parsed.custom.set(part, list);
  };
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const names: string[] = [];
      if (clause?.name) names.push("default");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) {
            names.push((element.propertyName ?? element.name).text);
          }
        }
      } else if (bindings) {
        names.push("*");
      }
      parsed.refs.push({
        specifier: node.moduleSpecifier.text,
        names,
        typeOnly:
          clause?.isTypeOnly === true ||
          (clause !== undefined && !names.length),
      });
    } else if (ts.isExportDeclaration(node)) {
      const specifier =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : null;
      const clause = node.exportClause;
      if (specifier) {
        const names: [string, string][] | "*" =
          clause && ts.isNamedExports(clause)
            ? clause.elements.map((element) => [
                (element.propertyName ?? element.name).text,
                element.name.text,
              ])
            : "*";
        parsed.reexports.push({ specifier, names });
        parsed.refs.push({
          specifier,
          names: names === "*" ? ["*"] : names.map(([from]) => from),
          typeOnly: node.isTypeOnly,
        });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          parsed.declares.add(element.name.text);
        }
      }
    } else if (isExported(node)) {
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            parsed.declares.add(declaration.name.text);
          }
        }
      } else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name
      ) {
        parsed.declares.add(node.name.text);
      }
    } else if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      readElement(node, source, addCustom);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return parsed;
}

function attribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): string | true | null {
  for (const property of node.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    ) {
      const value = property.initializer;
      if (value && ts.isStringLiteral(value)) return value.text;
      return true;
    }
  }
  return null;
}

function readElement(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile,
  addCustom: (part: string, detail: string) => void,
) {
  const tag = node.tagName.getText(source);
  const intrinsic = /^[a-z]/.test(tag) && !tag.includes(".");
  const role = attribute(node, "role");
  const pressed = attribute(node, "aria-pressed");
  if (typeof role === "string" && intrinsic && ROLES[role]) {
    addCustom(ROLES[role], `<${tag} role="${role}">`);
    return;
  }
  if (pressed !== null) {
    addCustom("toggle", `<${tag} aria-pressed>`);
    return;
  }
  if (!intrinsic) return;
  if (tag === "input") {
    const type = attribute(node, "type");
    const part =
      typeof type === "string" && type in INPUT_TYPES
        ? INPUT_TYPES[type]
        : "input";
    if (part) {
      addCustom(
        part,
        typeof type === "string" ? `<input type="${type}">` : "<input>",
      );
    }
    return;
  }
  const part = TAGS[tag];
  if (part) addCustom(part, `<${tag}>`);
}

const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveFile(repo: string, base: string): string | null {
  const stem = base.replace(/\.[cm]?js$/, "");
  for (const candidate of [stem, ...EXTENSIONS.map((ext) => stem + ext)]) {
    const full = path.join(repo, candidate);
    if (
      SOURCE.test(candidate) &&
      fs.existsSync(full) &&
      fs.statSync(full).isFile()
    ) {
      return candidate;
    }
  }
  return null;
}

type Classified = { part: string; usage: Usage; detail: string };

type Kept = { stamp: string; parsed: Parsed | "no-ui-imports" };
const PARSED = new Map<string, Kept>();

const SCANNER_HASH = createHash("sha1")
  .update(fs.readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

type StoredParse = {
  refs: ModuleRef[];
  declares: string[];
  reexports: Parsed["reexports"];
  custom: [string, string[]][];
};

interface StoredCache {
  scanner: string;
  files: Record<
    string,
    { stamp: string; parsed: StoredParse | "no-ui-imports" }
  >;
}

const loadedCaches = new Set<string>();

function loadCache(cacheFile: string) {
  if (loadedCaches.has(cacheFile)) return;
  loadedCaches.add(cacheFile);
  if (!fs.existsSync(cacheFile)) return;
  let stored: StoredCache;
  try {
    stored = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as StoredCache;
  } catch (error) {
    console.warn(`[migration-status] ignoring unreadable ${cacheFile}`, error);
    return;
  }
  if (stored.scanner !== SCANNER_HASH) return;
  for (const [file, kept] of Object.entries(stored.files)) {
    const parsed = kept.parsed;
    PARSED.set(file, {
      stamp: kept.stamp,
      parsed:
        parsed === "no-ui-imports"
          ? parsed
          : {
              refs: parsed.refs,
              declares: new Set(parsed.declares),
              reexports: parsed.reexports,
              custom: new Map(parsed.custom),
            },
    });
  }
}

function saveCache(cacheFile: string, repo: string) {
  const files: StoredCache["files"] = {};
  for (const [file, kept] of PARSED) {
    if (!file.startsWith(`${repo}${path.sep}`)) continue;
    const parsed = kept.parsed;
    files[file] = {
      stamp: kept.stamp,
      parsed:
        parsed === "no-ui-imports"
          ? parsed
          : {
              refs: parsed.refs,
              declares: [...parsed.declares],
              reexports: parsed.reexports,
              custom: [...parsed.custom],
            },
    };
  }
  const stored: StoredCache = { scanner: SCANNER_HASH, files };
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(stored));
}

export interface ScanOptions {
  apps?: AppSource[];
  /** Where parses are kept between runs; null keeps them in memory only. */
  cacheFile?: string | null;
}

const MAY_IMPORT_UI =
  /\/ui\b|radix|sonner|cmdk|vaul|base-ui|input-otp|day-picker|@agent-native\/toolkit/;

/** Scans every app and reports, per part, which files use which source. */
export function scanMigration(
  repo: string,
  options: ScanOptions = {},
): MigrationStatus {
  const apps = options.apps ?? defaultApps(repo);
  const cacheFile =
    options.cacheFile === undefined
      ? path.join(repo, ".tmp", "migration-status-cache.json")
      : options.cacheFile;
  if (cacheFile) loadCache(cacheFile);
  const parses = { fresh: 0 };
  const stamps = new Map<string, string>();
  const stampOf = (full: string) => {
    let stamp = stamps.get(full);
    if (stamp === undefined) {
      const stat = fs.statSync(full);
      stamp = `${stat.mtimeMs}:${stat.size}`;
      stamps.set(full, stamp);
    }
    return stamp;
  };

  const appFile = (file: string): Parsed | "no-ui-imports" => {
    const full = path.join(repo, file);
    const stamp = stampOf(full);
    const kept = PARSED.get(full);
    if (kept?.stamp === stamp) return kept.parsed;
    const text = fs.readFileSync(full, "utf8");
    const parsed =
      /\.[jt]sx$/.test(file) || MAY_IMPORT_UI.test(text)
        ? parse(file, text)
        : "no-ui-imports";
    PARSED.set(full, { stamp, parsed });
    parses.fresh += 1;
    return parsed;
  };

  const parsedFile = (file: string): Parsed => {
    const full = path.join(repo, file);
    const stamp = stampOf(full);
    const kept = PARSED.get(full);
    if (kept?.stamp === stamp && kept.parsed !== "no-ui-imports") {
      return kept.parsed;
    }
    const parsed = parse(file, fs.readFileSync(full, "utf8"));
    PARSED.set(full, { stamp, parsed });
    parses.fresh += 1;
    return parsed;
  };

  const resolved = new Map<string, string | null>();
  const resolveCached = (base: string) => {
    let hit = resolved.get(base);
    if (hit === undefined) {
      hit = resolveFile(repo, base);
      resolved.set(base, hit);
    }
    return hit;
  };

  const resolveSpecifier = (
    from: string,
    specifier: string,
    alias: string | null,
  ): string | null | "package" => {
    if (specifier.startsWith(".")) {
      return resolveCached(
        path.posix.join(path.posix.dirname(from), specifier),
      );
    }
    if (specifier.startsWith("@/")) {
      return alias ? resolveCached(`${alias}/${specifier.slice(2)}`) : null;
    }
    if (specifier === "@agent-native/toolkit") {
      return resolveCached("packages/toolkit/src/index");
    }
    if (
      specifier === "@agent-native/toolkit/ui" ||
      specifier.startsWith("@agent-native/toolkit/ui/")
    ) {
      return resolveCached(
        `${TOOLKIT_UI}${specifier.slice("@agent-native/toolkit/ui".length)}`,
      );
    }
    return "package";
  };

  const isUiFile = (file: string, uiDirs: string[]) =>
    file.startsWith(`${TOOLKIT_UI}/`) ||
    uiDirs.some((dir) => file.startsWith(`${dir}/`));

  const isBarrel = (file: string) => /\/index\.tsx?$/.test(file);

  const classifyPackage = (
    specifier: string,
    names: string[],
  ): Classified[] => {
    const radix = /^@radix-ui\/react-(.+)$/.exec(specifier);
    if (radix?.[1]) {
      return [{ part: partName(radix[1]), usage: "legacy", detail: specifier }];
    }
    if (specifier === "radix-ui") {
      return names
        .filter((name) => /^[A-Z]/.test(name))
        .map((name) => ({
          part: partName(kebab(name)),
          usage: "legacy",
          detail: `radix-ui ${name}`,
        }));
    }
    if (specifier.startsWith("@base-ui/react")) {
      const sub = specifier.split("/")[2];
      const parts = sub
        ? [sub]
        : names.filter((name) => /^[A-Z]/.test(name)).map(kebab);
      return parts
        .filter(
          (part) =>
            !part.startsWith("use-") &&
            !part.endsWith("-provider") &&
            part !== "merge-props",
        )
        .map((part) => ({
          part: partName(part),
          usage: "custom",
          detail: `${specifier} (direct, not the system part)`,
        }));
    }
    if (LEGACY_PACKAGES.has(specifier)) {
      return [
        { part: partName(specifier), usage: "legacy", detail: specifier },
      ];
    }
    return [];
  };

  const definersCache = new Map<string, Map<string, string>>();
  const definers = (
    file: string,
    alias: string | null,
  ): Map<string, string> => {
    const cached = definersCache.get(file);
    if (cached) return cached;
    const map = new Map<string, string>();
    definersCache.set(file, map);
    const parsed = parsedFile(file);
    for (const name of parsed.declares) map.set(name, file);
    for (const reexport of parsed.reexports) {
      const target = resolveSpecifier(file, reexport.specifier, alias);
      if (!target || target === "package") continue;
      const inner = definers(target, alias);
      if (reexport.names === "*") {
        for (const [name, definer] of inner) {
          if (!map.has(name)) map.set(name, definer);
        }
      } else {
        for (const [from, as] of reexport.names) {
          map.set(as, inner.get(from) ?? target);
        }
      }
    }
    return map;
  };

  const aliasFor = (app: AppSource, file: string) =>
    app.roots.find((root) => file.startsWith(`${root.dir}/`))?.alias ?? null;

  const moduleCache = new Map<string, Classified | null>();
  const classifyModule = (file: string, app: AppSource): Classified | null => {
    if (moduleCache.has(file)) return moduleCache.get(file) ?? null;
    moduleCache.set(file, null);
    const name = path.posix.basename(file).replace(/\.[jt]sx?$/, "");
    if (UTILITIES.has(name) || isBarrel(file)) return null;
    const part = partName(name);
    if (file.startsWith(`${SYSTEM_DIR}/`)) {
      const result: Classified = { part, usage: "native", detail: file };
      moduleCache.set(file, result);
      return result;
    }
    const parsed = parsedFile(file);
    const deps: Classified[] = [];
    for (const ref of parsed.refs) {
      if (ref.typeOnly) continue;
      const target = resolveSpecifier(file, ref.specifier, aliasFor(app, file));
      if (target === "package") {
        deps.push(...classifyPackage(ref.specifier, ref.names));
      } else if (target && isUiFile(target, app.uiDirs)) {
        const inner = classifyModule(target, app);
        if (inner) deps.push(inner);
      }
    }
    const passThrough =
      parsed.declares.size === 0 &&
      parsed.reexports.length > 0 &&
      parsed.refs.every(
        (ref) =>
          ref.typeOnly ||
          parsed.reexports.some((r) => r.specifier === ref.specifier),
      );
    const native = deps.filter((dep) => dep.usage === "native");
    let result: Classified;
    if (passThrough && deps.length > 0 && native.length === deps.length) {
      result = {
        part,
        usage: "native",
        detail: native.map((dep) => dep.detail).join(", "),
      };
    } else {
      const old = deps.find((dep) => dep.usage === "legacy");
      result = {
        part,
        usage: "legacy",
        detail: old
          ? `${file} (${old.detail})`
          : native.length
            ? `${file} (wraps ${native.map((dep) => dep.detail).join(", ")})`
            : file,
      };
    }
    moduleCache.set(file, result);
    return result;
  };

  const status: MigrationStatus = { apps: [], cells: {}, unresolved: [] };
  for (const app of apps) {
    moduleCache.clear();
    const cells: Record<string, Cell> = {};
    const add = (part: string, usage: Usage, file: string, detail: string) => {
      const cell = (cells[part] ??= { native: [], legacy: [], custom: [] });
      const existing = cell[usage].find((site) => site.file === file);
      if (existing) {
        if (!existing.detail.split("; ").includes(detail)) {
          existing.detail += `; ${detail}`;
        }
      } else {
        cell[usage].push({ file, detail });
      }
    };
    const files = app.roots
      .flatMap((root) => listSources(repo, root.dir))
      .filter((file) => !isUiFile(file, app.uiDirs));
    for (const file of files) {
      const parsed = appFile(file);
      if (parsed === "no-ui-imports") continue;
      const alias = aliasFor(app, file);
      for (const ref of parsed.refs) {
        if (ref.typeOnly) continue;
        const target = resolveSpecifier(file, ref.specifier, alias);
        if (target === "package") {
          for (const hit of classifyPackage(ref.specifier, ref.names)) {
            add(hit.part, hit.usage, file, hit.detail);
          }
          continue;
        }
        if (!target) {
          if (
            /^@\/components\/ui\/|^@agent-native\/toolkit\/ui/.test(
              ref.specifier,
            )
          ) {
            status.unresolved.push({
              app: app.id,
              file,
              specifier: ref.specifier,
            });
          }
          continue;
        }
        const uiBarrel =
          isBarrel(target) &&
          (isUiFile(target, app.uiDirs) || target === TOOLKIT_ROOT);
        if (!uiBarrel && !isUiFile(target, app.uiDirs)) continue;
        if (uiBarrel && ref.names.includes("*")) continue;
        let modules = [target];
        if (uiBarrel) {
          const exported = definers(target, aliasFor(app, target));
          modules = [];
          for (const name of ref.names) {
            const definer = exported.get(name);
            if (definer) {
              modules.push(definer);
            } else {
              status.unresolved.push({
                app: app.id,
                file,
                specifier: `${ref.specifier} { ${name} }`,
              });
            }
          }
        }
        for (const module of new Set(modules)) {
          if (!isUiFile(module, app.uiDirs)) continue;
          const hit = classifyModule(module, app);
          if (hit) {
            add(hit.part, hit.usage, file, `${ref.specifier} → ${hit.detail}`);
          }
        }
      }
      for (const [part, details] of parsed.custom) {
        const counts = new Map<string, number>();
        for (const detail of details)
          counts.set(detail, (counts.get(detail) ?? 0) + 1);
        for (const [detail, count] of counts) {
          add(part, "custom", file, count > 1 ? `${detail} ×${count}` : detail);
        }
      }
    }
    status.apps.push({ id: app.id, label: app.label, files: files.length });
    status.cells[app.id] = cells;
  }
  if (cacheFile && parses.fresh > 0) saveCache(cacheFile, repo);
  return status;
}

function selfAliased(dir: string): Pick<AppSource, "roots" | "uiDirs"> {
  return { roots: [{ dir, alias: dir }], uiDirs: [`${dir}/components/ui`] };
}

const TEMPLATE_PACKAGES: Readonly<Partial<Record<string, SourceRoot>>> = {
  dispatch: { dir: "packages/dispatch/src", alias: "packages/dispatch/src" },
};

const LABELS: Readonly<Partial<Record<string, string>>> = { crm: "CRM" };

/**
 * Every template with an app, then the other apps and packages that render
 * UI: Clips' desktop app and extension, the desktop shell, the docs site, the
 * UI packages, and the toolkit's own code.
 */
export function defaultApps(repo: string): AppSource[] {
  const templates = fs
    .readdirSync(path.join(repo, "templates"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(repo, "templates", entry.name, "app")),
    )
    .map((entry): AppSource => {
      const app = selfAliased(`templates/${entry.name}/app`);
      const extra = TEMPLATE_PACKAGES[entry.name];
      return {
        id: entry.name,
        label:
          LABELS[entry.name] ??
          `${entry.name.charAt(0).toUpperCase()}${entry.name.slice(1)}`,
        roots: extra ? [...app.roots, extra] : app.roots,
        uiDirs: extra
          ? [...app.uiDirs, `${extra.dir}/components/ui`]
          : app.uiDirs,
      };
    });
  const plain = (id: string, label: string, dir: string): AppSource => ({
    id,
    label,
    roots: [{ dir, alias: null }],
    uiDirs: [`${dir}/components/ui`, `${dir}/ui`],
  });
  return [
    ...templates,
    {
      id: "clips-desktop",
      label: "Clips desktop",
      ...selfAliased("templates/clips/desktop/src"),
    },
    plain(
      "clips-extension",
      "Clips extension",
      "templates/clips/chrome-extension/src",
    ),
    plain("desktop-app", "Desktop app", "packages/desktop-app/src/renderer"),
    { id: "docs", label: "Docs site", ...selfAliased("packages/docs/app") },
    plain("scheduling", "Scheduling", "packages/scheduling/src/react"),
    plain("code-agents", "Code agents", "packages/code-agents-ui/src"),
    plain(
      "creative-context",
      "Creative context",
      "packages/creative-context/src/client",
    ),
    {
      id: "toolkit",
      label: "Toolkit",
      roots: [{ dir: "packages/toolkit/src", alias: null }],
      uiDirs: [],
    },
  ];
}
