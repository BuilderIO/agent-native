import { parse } from "@babel/parser";

import type { ActionHttpConfig } from "../action.js";

export type CliWrapperFlags = {
  http?: ActionHttpConfig | false;
  agentTool?: false;
  needsApproval?: true;
  persistInBrowser?: false;
  uiOnly?: true;
  toolCallable?: false;
};

/**
 * The parts of a Babel AST node the reader looks at. Each node type has only
 * some of them, so the reader checks `type` before reading one. `value` is a
 * node on an object property and the literal itself on a literal.
 */
type BabelNode = {
  type: string;
  name?: string;
  value?: BabelNode | string | number | boolean;
  computed?: boolean;
  kind?: string;
  exportKind?: string;
  importKind?: string;
  source?: BabelNode;
  expression?: BabelNode;
  key?: BabelNode;
  object?: BabelNode;
  property?: BabelNode;
  left?: BabelNode;
  right?: BabelNode;
  argument?: BabelNode | null;
  callee?: BabelNode;
  declaration?: BabelNode | null;
  id?: BabelNode | null;
  init?: BabelNode | null;
  exported?: BabelNode;
  imported?: BabelNode;
  local?: BabelNode;
  arguments?: BabelNode[];
  declarations?: BabelNode[];
  specifiers?: BabelNode[];
  properties?: BabelNode[];
  expressions?: BabelNode[];
  quasis?: Array<{ value?: { cooked?: string | null } }>;
};
type BabelProgram = { type: string; body: BabelNode[] };

/** The flags the reader checks, each with the value that keeps an action safe. */
const SAFE_VALUES = {
  needsApproval: true,
  persistInBrowser: false,
  uiOnly: true,
  toolCallable: false,
} as const;
type ReadFlag = keyof typeof SAFE_VALUES;
const READ_FLAGS = Object.keys(SAFE_VALUES) as ReadFlag[];
/** A flag's literal value, or "unknown" when the source sets it some other way. */
type ReadFlags = Partial<Record<ReadFlag, boolean | "unknown">>;
const UNKNOWN_FLAGS: ReadFlags = Object.fromEntries(
  READ_FLAGS.map((name) => [name, "unknown"]),
);

const TYPE_ONLY_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);
/** The modules that export the framework's own `defineAction`. */
const ACTION_MODULES = new Set([
  "@agent-native/core",
  "@agent-native/core/action",
]);
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

function parseProgram(src: string): BabelProgram | null {
  for (const plugins of [["typescript"], ["typescript", "jsx"]] as const) {
    try {
      return parse(src, { sourceType: "unambiguous", plugins: [...plugins] })
        .program as unknown as BabelProgram;
    } catch {
      // coercion-ok: try the next syntax. If neither parses, the null return
      // makes the caller gate the action and keep its results out of the
      // browser.
    }
  }
  return null;
}

/** Strips casts and parentheses, which don't change the value at runtime. */
function unwrap(node: BabelNode | null | undefined): BabelNode | undefined {
  let current = node ?? undefined;
  while (current && TYPE_ONLY_WRAPPERS.has(current.type)) {
    current = current.expression;
  }
  return current;
}

function forEachNode(node: unknown, visit: (node: BabelNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) forEachNode(child, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof (node as BabelNode).type !== "string") return;
  visit(node as BabelNode);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "loc" && child && typeof child === "object") {
      forEachNode(child, visit);
    }
  }
}

/** An identifier's name, or undefined for any other node. */
function identifierName(
  node: BabelNode | null | undefined,
): string | undefined {
  return node?.type === "Identifier" ? node.name : undefined;
}

/** The name an import or export specifier gives, which may be a string. */
function specifierName(node: BabelNode | undefined): string | undefined {
  const name = identifierName(node) ?? node?.value;
  return typeof name === "string" ? name : undefined;
}

/** A `true` or `false` literal's value, or "unknown" for anything else. */
function booleanLiteral(
  node: BabelNode | "unknown" | undefined,
): boolean | "unknown" {
  if (node === "unknown" || node?.type !== "BooleanLiteral") return "unknown";
  return typeof node.value === "boolean" ? node.value : "unknown";
}

function propertyName(prop: BabelNode): string | null {
  const key = prop.key;
  if (!key) return null;
  if (!prop.computed && key.type === "Identifier") return key.name ?? null;
  if (key.type === "StringLiteral" && typeof key.value === "string") {
    return key.value;
  }
  if (key.type === "NumericLiteral") return String(key.value);
  if (key.type === "TemplateLiteral" && key.expressions?.length === 0) {
    const text = key.quasis?.[0]?.value?.cooked;
    return typeof text === "string" ? text : null;
  }
  return null;
}

function isModuleExports(node: BabelNode | undefined): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    identifierName(node.object) === "module" &&
    identifierName(node.property) === "exports"
  );
}

function mentions(node: unknown, name: string): boolean {
  let found = false;
  forEachNode(node, (child) => {
    if (child.type === "Identifier" && child.name === name) found = true;
  });
  return found;
}

/**
 * Whether the module does anything with the exported binding besides
 * declaring and exporting it. Reassigning, mutating or passing it to another
 * call can change what the loaders see, so the declaration alone says nothing
 * certain. A function only has to keep its binding: the loaders read none of
 * its properties.
 */
function isTouched(
  program: BabelProgram,
  name: string,
  value: BabelNode | undefined,
): boolean {
  if (!value || !FUNCTIONS.has(value.type)) {
    let count = 0;
    forEachNode(program, (node) => {
      if (node.type === "Identifier" && node.name === name) count++;
    });
    return count > 2;
  }
  let reassigned = false;
  forEachNode(program, (node) => {
    const target =
      node.type === "AssignmentExpression" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : undefined;
    if (target?.type !== "MemberExpression" && mentions(target, name)) {
      reassigned = true;
    }
  });
  return reassigned;
}

/**
 * The module's default export (or `module.exports`), followed through a
 * top-level binding the module leaves alone. `"unknown"` for a default
 * re-exported from another file or a binding it changes.
 */
function exportedValue(
  program: BabelProgram,
): BabelNode | "unknown" | undefined {
  let value: BabelNode | "unknown" | undefined;
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      value = unwrap(statement.declaration);
    } else if (
      statement.type === "ExpressionStatement" &&
      statement.expression?.type === "AssignmentExpression" &&
      isModuleExports(statement.expression.left)
    ) {
      value = unwrap(statement.expression.right);
    } else if (
      statement.type === "TSExportAssignment" ||
      (statement.type === "ExportNamedDeclaration" &&
        statement.specifiers?.some(
          (spec) => specifierName(spec.exported) === "default",
        ))
    ) {
      // How a loader sees TypeScript's `export =` depends on how it compiles
      // the module, so the reader can't say which object is the action.
      value = "unknown";
    }
  }
  if (value === "unknown") return value;
  const name = identifierName(value);
  if (!value || name === undefined) return value;
  const found: BabelNode[] = [];
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      declaration &&
      FUNCTIONS.has(declaration.type) &&
      identifierName(declaration.id) === name
    ) {
      found.push(declaration);
    }
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations ?? []) {
      if (identifierName(declarator.id) === name) {
        found.push(unwrap(declarator.init) ?? value);
      }
    }
  }
  if (found.length > 1 || isTouched(program, name, found[0])) {
    return "unknown";
  }
  return found[0] ?? value;
}

/**
 * What the module exports by name, each with its value when it's a `const`
 * or a declared function, and whether it might export more than it names:
 * a whole file re-exported, or CommonJS `exports.x = ...` writes.
 */
function namedExports(program: BabelProgram): {
  names: Map<string, BabelNode | "unknown">;
  star: boolean;
} {
  const names = new Map<string, BabelNode | "unknown">();
  let star = false;
  let wholeModuleExports = 0;
  for (const statement of program.body) {
    if (statement.type === "ExportAllDeclaration") star = true;
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression?.type === "AssignmentExpression" &&
      isModuleExports(statement.expression.left)
    ) {
      wholeModuleExports++;
    }
    if (
      statement.type !== "ExportNamedDeclaration" ||
      statement.exportKind === "type"
    ) {
      continue;
    }
    const declaration = statement.declaration;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations ?? []) {
        const name = identifierName(declarator.id);
        if (name !== undefined) {
          const value =
            declaration.kind === "const" ? unwrap(declarator.init) : undefined;
          names.set(name, value ?? "unknown");
        } else {
          // Destructured: any name in the pattern might be exported.
          forEachNode(declarator.id, (node) => {
            const bound = identifierName(node);
            if (bound !== undefined) names.set(bound, "unknown");
          });
        }
      }
    } else if (declaration?.id?.name !== undefined) {
      names.set(declaration.id.name, declaration);
    }
    for (const spec of statement.specifiers ?? []) {
      const name = specifierName(spec.exported);
      if (name !== undefined && name !== "default") {
        names.set(name, "unknown");
      }
    }
  }
  // Each `module.exports = value` names `exports` once; any other mention
  // could be a CommonJS export.
  let exportsMentions = 0;
  forEachNode(program, (node) => {
    if (node.type === "Identifier" && node.name === "exports") {
      exportsMentions++;
    }
  });
  if (exportsMentions > wholeModuleExports) star = true;
  return { names, star };
}

/**
 * The options object passed to the `defineAction` call the module exports as
 * its default, `"unknown"` when the parser can't tell what they are, or null
 * when the default export isn't an action. A `defineAction` call that isn't
 * the export proves nothing about the action that is.
 */
function defaultActionOptions(
  program: BabelProgram,
): BabelNode | "unknown" | null {
  // Only the framework's `defineAction` is known to keep the options it's
  // given. A local helper or another module's function of the same name could
  // change them, so a call to one proves nothing.
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of program.body) {
    const from = statement.source?.value;
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      typeof from !== "string" ||
      !ACTION_MODULES.has(from)
    ) {
      continue;
    }
    for (const spec of statement.specifiers ?? []) {
      const local = identifierName(spec.local);
      if (local === undefined || spec.importKind === "type") continue;
      if (spec.type === "ImportNamespaceSpecifier") namespaces.add(local);
      if (
        spec.type === "ImportSpecifier" &&
        specifierName(spec.imported) === "defineAction"
      ) {
        names.add(local);
      }
    }
  }
  const calls: BabelNode[] = [];
  forEachNode(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrap(node.callee);
    const calleeName = identifierName(callee);
    const namespace =
      callee?.type === "MemberExpression" && !callee.computed
        ? identifierName(callee.object)
        : undefined;
    if (
      (calleeName !== undefined && names.has(calleeName)) ||
      (namespace !== undefined &&
        namespaces.has(namespace) &&
        identifierName(callee?.property) === "defineAction")
    ) {
      calls.push(node);
    }
  });
  const exported = exportedValue(program);
  const call = calls.find((c) => c === exported);
  if (call) return unwrap(call.arguments?.[0]) ?? "unknown";
  if (calls.length > 0 || exported === "unknown") return "unknown";
  if (!exported || FUNCTIONS.has(exported.type)) return null;
  return isActionObject(exported) ? exported : "unknown";
}

/**
 * An object literal with its own `tool` and `run`, the shape the action
 * loaders accept without `defineAction`. Any other object might be config
 * that happens to carry a flag's name.
 */
function isActionObject(node: BabelNode): boolean {
  if (node.type !== "ObjectExpression") return false;
  const names = new Set(
    (node.properties ?? []).map((prop) =>
      prop.type === "SpreadElement" ? null : propertyName(prop),
    ),
  );
  return names.has("tool") && names.has("run");
}

/** The flags an options object sets, read in order the way JavaScript would. */
function readOptionFlags(options: BabelNode | "unknown"): ReadFlags {
  if (options === "unknown" || options.type !== "ObjectExpression") {
    return { ...UNKNOWN_FLAGS };
  }
  const flags: ReadFlags = {};
  for (const prop of options.properties ?? []) {
    const name = prop.type === "SpreadElement" ? null : propertyName(prop);
    if (name === null) {
      // A spread or a computed key can set any flag.
      Object.assign(flags, UNKNOWN_FLAGS);
    } else if ((READ_FLAGS as readonly string[]).includes(name)) {
      const value =
        prop.type === "ObjectProperty" && typeof prop.value === "object"
          ? unwrap(prop.value)
          : undefined;
      flags[name as ReadFlag] = booleanLiteral(value);
    }
  }
  return flags;
}

/**
 * The flags of the action the module exports, or null for a module that
 * defines none. The loaders take an action from the default export or from
 * named `tool` and `run` exports, and don't agree on which comes first, so a
 * module offering both, or re-exporting a whole file, gets every limit.
 */
function actionFlags(program: BabelProgram): ReadFlags | null {
  const fromDefault = defaultActionOptions(program);
  const { names, star } = namedExports(program);
  const named = names.has("tool") && names.has("run");
  if (!named && !star) {
    return fromDefault === null ? null : readOptionFlags(fromDefault);
  }
  if (fromDefault !== null || !named) return { ...UNKNOWN_FLAGS };
  const flags: ReadFlags = {};
  for (const name of READ_FLAGS) {
    const value = names.get(name);
    if (value === undefined) {
      if (star) flags[name] = "unknown";
    } else {
      flags[name] = booleanLiteral(value);
    }
  }
  return flags;
}

/**
 * The flags the dev scan reads from an action's source when it can't import
 * the module and falls back to running it through `pnpm action`. It parses
 * the source rather than running it, so it errs toward the safe side: only a
 * literal `needsApproval: false` skips the approval gate, only a literal
 * `persistInBrowser: true` lets the browser keep results, only a literal
 * `uiOnly: false` lets the agent and other callers reach it, and only a
 * literal `toolCallable: true` lets tool calls in, whether set in the
 * options or as a named `const` export beside `tool` and `run`. Any other
 * value sets the safe one, and so do options it can't see (spread in, passed
 * by name, built by another helper or a `defineAction` that isn't the
 * framework's, re-exported, or exported through a binding the module changes)
 * and a source it can't parse. A module that
 * defines no action gets none of them.
 */
export function cliWrapperFlagsFromSource(src: string): CliWrapperFlags {
  const out: CliWrapperFlags = {};
  const program = parseProgram(src);
  const flags = program ? actionFlags(program) : { ...UNKNOWN_FLAGS };
  if (flags !== null) {
    for (const name of READ_FLAGS) {
      const value = flags[name];
      // Only leaving a flag out, or setting it to the literal opposite of
      // its safe value, keeps the action open.
      if (value !== undefined && value !== !SAFE_VALUES[name]) {
        (out as Record<ReadFlag, boolean>)[name] = SAFE_VALUES[name];
      }
    }
  }
  if (/\bagentTool\s*:\s*false\b/.test(src)) out.agentTool = false;
  if (/\bhttp\s*:\s*false\b/.test(src)) {
    out.http = false;
  } else {
    const httpStart = src.search(/\bhttp\s*:\s*\{/);
    if (httpStart >= 0) {
      const window = src.slice(httpStart, httpStart + 200);
      const m = window.match(/method\s*:\s*['"`](GET|POST|PUT|DELETE)['"`]/);
      const p = window.match(/path\s*:\s*['"`]([^'"`]+)['"`]/);
      if (m || p) {
        out.http = {
          ...(m ? { method: m[1] as "GET" | "POST" | "PUT" | "DELETE" } : {}),
          ...(p ? { path: p[1] } : {}),
        };
      }
    }
  }
  return out;
}
