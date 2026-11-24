import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { COMPONENTS } from "./components.ts";
import { Edits, OverlappingEditsError } from "./edits.ts";
import type {
  Analysis,
  CodemodOptions,
  ComponentDef,
  ComponentName,
  ImportName,
  SiteContext,
} from "./types.ts";
import { COMPONENT_NAMES } from "./types.ts";

export interface Finding {
  file: string;
  line: number;
  offset: number;
  component: ComponentName;
  reason: string;
}

export interface ShimResult {
  file: string;
  component: ComponentName;
  swapped: boolean;
  blockers: string[];
}

export interface FileChange {
  file: string;
  before: string;
  after: string;
  sites: Partial<Record<ComponentName, number>>;
}

export interface CodemodResult {
  changes: FileChange[];
  skipped: Finding[];
  review: Finding[];
  shims: ShimResult[];
  mocks: Finding[];
  counts: Record<ComponentName, number>;
}

const SOURCE = /\.(tsx?|mts|cts)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".react-router",
  ".generated",
  ".output",
  ".netlify",
  ".tmp",
]);

function listSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

function projectRoot(dir: string): string {
  for (let at = dir; ; at = path.dirname(at)) {
    if (
      fs.existsSync(path.join(at, "tsconfig.json")) ||
      fs.existsSync(path.join(at, "package.json"))
    ) {
      return at;
    }
    if (path.dirname(at) === at) return dir;
  }
}

interface Resolver {
  resolve(from: string, specifier: string): string | null;
}

function createResolver(root: string): Resolver {
  const configPath = path.join(root, "tsconfig.json");
  let paths: Record<string, string[]> = {};
  let base = root;
  if (fs.existsSync(configPath)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
      throw new Error(
        `can't read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`,
      );
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    paths = parsed.options.paths ?? {};
    base = parsed.options.baseUrl ?? root;
  }
  const probe = (stem: string): string | null => {
    for (const candidate of [
      stem,
      `${stem}.tsx`,
      `${stem}.ts`,
      path.join(stem, "index.tsx"),
      path.join(stem, "index.ts"),
    ]) {
      if (
        SOURCE.test(candidate) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        return candidate;
      }
    }
    return null;
  };
  return {
    resolve(from, specifier) {
      if (specifier.startsWith(".")) {
        return probe(
          path.resolve(path.dirname(from), specifier.replace(/\.js$/, "")),
        );
      }
      for (const [pattern, targets] of Object.entries(paths)) {
        const star = pattern.indexOf("*");
        const prefix = star === -1 ? pattern : pattern.slice(0, star);
        const suffix = star === -1 ? "" : pattern.slice(star + 1);
        if (
          star === -1
            ? specifier !== pattern
            : !(specifier.startsWith(prefix) && specifier.endsWith(suffix))
        ) {
          continue;
        }
        const matched =
          star === -1
            ? ""
            : specifier.slice(prefix.length, specifier.length - suffix.length);
        for (const target of targets) {
          const hit = probe(path.resolve(base, target.replace("*", matched)));
          if (hit) return hit;
        }
      }
      return null;
    },
  };
}

function shimComponent(text: string): ComponentName | null {
  const source = ts.createSourceFile("shim.ts", text, ts.ScriptTarget.Latest);
  let found: ComponentName | null = null;
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return null;
    }
    const component = legacyComponent(statement.moduleSpecifier.text);
    if (!component || (found && found !== component)) return null;
    found = component;
  }
  return found;
}

function legacyComponent(specifier: string): ComponentName | null {
  for (const name of COMPONENT_NAMES) {
    if (COMPONENTS[name].legacy.includes(specifier)) return name;
  }
  return null;
}

interface ImportRef {
  declaration: ts.ImportDeclaration | ts.ExportDeclaration;
  component: ComponentName;
  shim: string | null;
}

interface Site {
  node: ts.Node;
  component: ComponentName;
  analysis: Analysis;
}

interface FilePlan {
  file: string;
  source: ts.SourceFile;
  refs: ImportRef[];
  referenced: Map<ComponentName, Set<string>>;
  components: Map<
    ComponentName,
    { sites: Site[]; blockers: { node: ts.Node; reason: string }[] }
  >;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function runCodemod(
  dir: string,
  options: CodemodOptions = {},
): CodemodResult {
  const absolute = path.resolve(dir);
  const enabled = new Set<ComponentName>(options.transforms ?? COMPONENT_NAMES);
  const root = projectRoot(absolute);
  const resolver = createResolver(root);
  const rel = (file: string) => path.relative(absolute, file);

  const projectFiles = listSources(root);
  const shims = new Map<string, ComponentName>();
  const texts = new Map<string, string>();
  const read = (file: string) => {
    let text = texts.get(file);
    if (text === undefined) {
      text = fs.readFileSync(file, "utf8");
      texts.set(file, text);
    }
    return text;
  };
  for (const file of projectFiles) {
    const text = read(file);
    if (text.length < 2000 && /export/.test(text)) {
      const component = shimComponent(text);
      if (component) shims.set(file, component);
    }
  }
  const shimImporters = new Map<string, Set<string>>();
  const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  for (const file of projectFiles) {
    if (shims.has(file)) continue;
    for (const match of read(file).matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (!specifier) continue;
      const target = resolver.resolve(file, specifier);
      if (target && shims.has(target)) {
        const set = shimImporters.get(target) ?? new Set<string>();
        set.add(file);
        shimImporters.set(target, set);
      }
    }
  }

  const files = listSources(absolute).filter((file) => !shims.has(file));
  const program = ts.createProgram(files, {
    noResolve: true,
    noLib: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
    allowJs: false,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();

  const plans: FilePlan[] = [];
  const mocks: {
    file: string;
    source: ts.SourceFile;
    specifier: ts.StringLiteral;
    component: ComponentName;
    shim: string | null;
  }[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const plan = planFile(file, source);
    if (plan) plans.push(plan);
    if (/\b(vi|jest)\.(do)?[mM]ock\(/.test(source.text))
      findMocks(file, source);
  }

  function findMocks(file: string, source: ts.SourceFile) {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        /^(vi|jest)$/.test(node.expression.expression.getText(source)) &&
        /^(mock|doMock)$/.test(node.expression.name.text)
      ) {
        const first = node.arguments.at(0);
        if (first && ts.isStringLiteral(first)) {
          const direct = legacyComponent(first.text);
          const target = direct ? null : resolver.resolve(file, first.text);
          const viaShim = target ? shims.get(target) : undefined;
          const component = direct ?? viaShim;
          if (component && enabled.has(component)) {
            mocks.push({
              file,
              source,
              specifier: first,
              component,
              shim: viaShim && target ? target : null,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  function refFor(
    file: string,
    declaration: ts.ImportDeclaration | ts.ExportDeclaration,
  ): ImportRef | null {
    const specifier = declaration.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) return null;
    const direct = legacyComponent(specifier.text);
    if (direct) return { declaration, component: direct, shim: null };
    const target = resolver.resolve(file, specifier.text);
    const viaShim = target ? shims.get(target) : undefined;
    return target && viaShim
      ? { declaration, component: viaShim, shim: target }
      : null;
  }

  function planFile(file: string, source: ts.SourceFile): FilePlan | null {
    const refs: ImportRef[] = [];
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)
      ) {
        const ref = refFor(file, statement);
        if (ref && enabled.has(ref.component)) refs.push(ref);
      }
    }
    if (refs.length === 0) return null;

    const identifiers = new Map<string, ts.Identifier[]>();
    const collect = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const list = identifiers.get(node.text) ?? [];
        list.push(node);
        identifiers.set(node.text, list);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    const freshUsed = new Set<string>();
    const fresh = (base: string) => {
      for (let index = 1; ; index += 1) {
        const name = index === 1 ? base : `${base}${index}`;
        if (!identifiers.has(name) && !freshUsed.has(name)) {
          freshUsed.add(name);
          return name;
        }
      }
    };

    const components: FilePlan["components"] = new Map();
    const referenced: FilePlan["referenced"] = new Map();
    const entry = (component: ComponentName) => {
      let value = components.get(component);
      if (!value) {
        value = { sites: [], blockers: [] };
        components.set(component, value);
      }
      return value;
    };

    for (const ref of refs) {
      const def = COMPONENTS[ref.component];
      const state = entry(ref.component);
      const declaration = ref.declaration;
      if (ts.isExportDeclaration(declaration)) {
        state.blockers.push({
          node: declaration,
          reason: "re-exports the legacy component",
        });
        continue;
      }
      const clause = declaration.importClause;
      if (!clause) {
        state.blockers.push({
          node: declaration,
          reason: "side-effect import",
        });
        continue;
      }
      if (clause.name) {
        state.blockers.push({ node: clause, reason: "default import" });
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        state.blockers.push({ node: bindings, reason: "namespace import" });
        continue;
      }
      for (const element of bindings?.elements ?? []) {
        const imported = (element.propertyName ?? element.name).text;
        const local = element.name.text;
        const next = new Map(Object.entries(def.names)).get(imported);
        if (next === undefined || next === null) {
          state.blockers.push({
            node: element,
            reason: `imports \`${imported}\`, which the new module doesn't have${next === null ? " (or changed)" : ""}`,
          });
          continue;
        }
        if (clause.isTypeOnly || element.isTypeOnly) continue;
        const symbol = checker.getSymbolAtLocation(element.name);
        const context: SiteContext = {
          source,
          checker,
          imported,
          local,
          options,
          fresh,
          nameInUse: (name) => identifiers.has(name),
        };
        for (const identifier of identifiers.get(local) ?? []) {
          if (identifier === element.name) continue;
          if (checker.getSymbolAtLocation(identifier) !== symbol) continue;
          const parent = identifier.parent;
          if (ts.isJsxClosingElement(parent)) continue;
          let analysis: Analysis;
          let node: ts.Node = identifier;
          if (
            (ts.isJsxOpeningElement(parent) ||
              ts.isJsxSelfClosingElement(parent)) &&
            parent.tagName === identifier
          ) {
            node = ts.isJsxOpeningElement(parent) ? parent.parent : parent;
            analysis = def.jsx
              ? def.jsx(parent, context)
              : { ok: false, reason: "JSX use" };
          } else if (def.reference) {
            analysis = def.reference(identifier, context);
            if (ts.isCallExpression(identifier.parent))
              node = identifier.parent;
            else if (ts.isCallExpression(identifier.parent.parent)) {
              node = identifier.parent.parent;
            }
          } else {
            analysis = {
              ok: false,
              reason: "used as a value, not as a JSX element",
            };
          }
          state.sites.push({ node, component: ref.component, analysis });
          const locals = referenced.get(ref.component) ?? new Set<string>();
          locals.add(local);
          referenced.set(ref.component, locals);
          if (!analysis.ok) {
            state.blockers.push({ node, reason: analysis.reason });
          }
        }
      }
    }
    return { file, source, refs, components, referenced };
  }

  const shimResults: ShimResult[] = [];
  const swapped = new Set<string>();
  for (const [shim, component] of shims) {
    if (!enabled.has(component)) continue;
    const importers = [...(shimImporters.get(shim) ?? [])];
    if (importers.length === 0) continue;
    const blockers: string[] = [];
    for (const importer of importers) {
      const plan = plans.find((candidate) => candidate.file === importer);
      if (!importer.startsWith(`${absolute}${path.sep}`)) {
        blockers.push(
          `${path.relative(absolute, importer)} (outside the directory)`,
        );
      } else if (!plan) {
        blockers.push(`${rel(importer)} (not parsed)`);
      } else if ((plan.components.get(component)?.blockers.length ?? 0) > 0) {
        blockers.push(rel(importer));
      }
    }
    if (blockers.length === 0) swapped.add(shim);
    shimResults.push({
      file: rel(shim),
      component,
      swapped: blockers.length === 0,
      blockers,
    });
  }

  const result: CodemodResult = {
    changes: [],
    skipped: [],
    review: [],
    shims: shimResults,
    mocks: mocks.map(({ file, source, specifier, component, shim }) => ({
      file: rel(file),
      line: lineOf(source, specifier),
      offset: specifier.getStart(source),
      component,
      reason:
        shim !== null && swapped.has(shim)
          ? `mocks "${specifier.text}", which now re-exports ${COMPONENTS[component].next}: the mock must match it`
          : `mocks "${specifier.text}"; code that moved imports ${COMPONENTS[component].next} instead`,
    })),
    counts: Object.fromEntries(
      COMPONENT_NAMES.map((name) => [name, 0]),
    ) as Record<ComponentName, number>,
  };

  for (const plan of plans) {
    const { source } = plan;
    const finding = (
      node: ts.Node,
      component: ComponentName,
      reason: string,
    ): Finding => ({
      file: rel(plan.file),
      line: lineOf(source, node),
      offset: node.getStart(source),
      component,
      reason,
    });
    const moving = new Set<ComponentName>();
    for (const [component, state] of plan.components) {
      if (state.blockers.length === 0) {
        moving.add(component);
        continue;
      }
      for (const blocker of state.blockers) {
        result.skipped.push(finding(blocker.node, component, blocker.reason));
      }
      for (const site of state.sites) {
        if (site.analysis.ok) {
          result.skipped.push(
            finding(
              site.node,
              component,
              "held back: another site in the file can't move",
            ),
          );
        }
      }
    }
    if (moving.size === 0) continue;

    const edits = new Edits(source.text);
    const sites = [...plan.components]
      .filter(([component]) => moving.has(component))
      .flatMap(([, state]) => state.sites);
    sites.sort(
      (a, b) =>
        b.node.getStart(source) - a.node.getStart(source) ||
        a.node.end - b.node.end,
    );
    const counts: Partial<Record<ComponentName, number>> = {};
    const uses = new Map<ComponentName, ImportName[]>();
    for (const site of sites) {
      if (!site.analysis.ok) continue;
      site.analysis.build(edits);
      counts[site.component] = (counts[site.component] ?? 0) + 1;
      uses.set(site.component, [
        ...(uses.get(site.component) ?? []),
        ...site.analysis.uses,
      ]);
      for (const reason of site.analysis.reviews) {
        result.review.push(finding(site.node, site.component, reason));
      }
    }
    for (const component of moving) {
      const refs = plan.refs.filter((ref) => ref.component === component);
      const def = COMPONENTS[component];
      const componentUses = uses.get(component) ?? [];
      const used = new Set(componentUses.map((use) => use.local));
      const declared = new Set(
        refs.flatMap((ref) =>
          ts.isImportDeclaration(ref.declaration)
            ? importElements(ref.declaration).map((element) =>
                nextLocal(element, def),
              )
            : [],
        ),
      );
      const extras = componentUses.filter(
        (use, index) =>
          !declared.has(use.local) &&
          componentUses.findIndex((other) => other.local === use.local) ===
            index,
      );
      const referenced = plan.referenced.get(component) ?? new Set<string>();
      refs.forEach((ref, index) =>
        rewriteImport(
          edits,
          ref,
          used,
          referenced,
          index === 0 ? extras : [],
          swapped,
        ),
      );
    }
    let after: string;
    try {
      after = edits.apply();
    } catch (error) {
      if (!(error instanceof OverlappingEditsError)) throw error;
      const line =
        source.getLineAndCharacterOfPosition(error.position).line + 1;
      for (const component of moving) {
        result.skipped.push({
          file: rel(plan.file),
          line,
          component,
          reason: "transforms overlap here; the file was left alone",
        });
      }
      continue;
    }
    for (const [component, count] of Object.entries(counts)) {
      result.counts[component as ComponentName] += count;
    }
    if (after !== source.text) {
      result.changes.push({
        file: rel(plan.file),
        before: source.text,
        after,
        sites: counts,
      });
    }
  }

  for (const shim of swapped) {
    const component = shims.get(shim);
    if (!component) continue;
    const text = read(shim);
    const after = `export * from "${COMPONENTS[component].next}";\n`;
    if (text !== after) {
      result.changes.push({ file: rel(shim), before: text, after, sites: {} });
    }
  }
  result.changes.sort((a, b) => a.file.localeCompare(b.file));
  return result;
}

function nextLocal(
  element: ts.ImportSpecifier,
  def: ComponentDef,
): string | null {
  const imported = (element.propertyName ?? element.name).text;
  const next = def.names[imported];
  if (!next) return null;
  return element.name.text === imported ? next : element.name.text;
}

function importElements(
  declaration: ts.ImportDeclaration,
): ts.ImportSpecifier[] {
  const bindings = declaration.importClause?.namedBindings;
  return bindings && ts.isNamedImports(bindings) ? [...bindings.elements] : [];
}

function rewriteImport(
  edits: Edits,
  ref: ImportRef,
  used: Set<string>,
  referenced: Set<string>,
  extras: ImportName[],
  swapped: Set<string>,
) {
  const declaration = ref.declaration;
  if (!ts.isImportDeclaration(declaration)) return;
  const clause = declaration.importClause;
  if (!clause) return;
  const def = COMPONENTS[ref.component];
  const specifier =
    ref.shim && swapped.has(ref.shim)
      ? (declaration.moduleSpecifier as ts.StringLiteral).text
      : def.next;
  const names: { imported: string; local: string; type: boolean }[] = [];
  const add = (imported: string, local: string, type: boolean) => {
    if (!names.some((name) => name.local === local)) {
      names.push({ imported, local, type });
    }
  };
  for (const element of importElements(declaration)) {
    const imported = def.names[(element.propertyName ?? element.name).text];
    const local = nextLocal(element, def);
    if (!imported || !local) continue;
    const type = clause.isTypeOnly || element.isTypeOnly;
    if (!type && referenced.has(element.name.text) && !used.has(local))
      continue;
    add(imported, local, type);
  }
  for (const extra of extras) add(extra.imported, extra.local, false);
  if (names.length === 0) {
    edits.add(declaration.getFullStart(), declaration.end, "");
    return;
  }
  const list = names
    .map(
      ({ imported, local, type }) =>
        `${type && !clause.isTypeOnly ? "type " : ""}${imported === local ? imported : `${imported} as ${local}`}`,
    )
    .join(", ");
  edits.add(
    declaration.getStart(),
    declaration.end,
    `import ${clause.isTypeOnly ? "type " : ""}{ ${list} } from "${specifier}";`,
  );
}
