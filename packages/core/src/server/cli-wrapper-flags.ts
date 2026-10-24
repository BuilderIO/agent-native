import { parse } from "@babel/parser";

import type { ActionHttpConfig } from "../action.js";

export type CliWrapperFlags = {
  http?: ActionHttpConfig | false;
  agentTool?: false;
  needsApproval?: true;
  persistInBrowser?: false;
};

type BabelNode = { type: string; [key: string]: any };

const READ_FLAGS = ["needsApproval", "persistInBrowser"] as const;
type ReadFlag = (typeof READ_FLAGS)[number];
/** A flag's literal value, or "unknown" when the source sets it some other way. */
type ReadFlags = Partial<Record<ReadFlag, boolean | "unknown">>;
const UNKNOWN_FLAGS: ReadFlags = {
  needsApproval: "unknown",
  persistInBrowser: "unknown",
};

const TYPE_ONLY_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

function parseProgram(src: string): BabelNode | null {
  for (const plugins of [["typescript"], ["typescript", "jsx"]] as const) {
    try {
      return parse(src, { sourceType: "unambiguous", plugins: [...plugins] })
        .program as unknown as BabelNode;
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

function propertyName(prop: BabelNode): string | null {
  const key = prop.key;
  if (!prop.computed && key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "NumericLiteral") return String(key.value);
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    const text = key.quasis[0]?.value?.cooked;
    return typeof text === "string" ? text : null;
  }
  return null;
}

function isModuleExports(node: BabelNode): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "module" &&
    node.property.type === "Identifier" &&
    node.property.name === "exports"
  );
}

/**
 * The module's default export (or `module.exports`), followed through a
 * top-level variable. `"unknown"` for a default re-exported from another file.
 */
function exportedValue(program: BabelNode): BabelNode | "unknown" | undefined {
  let value: BabelNode | "unknown" | undefined;
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      value = unwrap(statement.declaration);
    } else if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AssignmentExpression" &&
      isModuleExports(statement.expression.left)
    ) {
      value = unwrap(statement.expression.right);
    } else if (
      statement.type === "ExportNamedDeclaration" &&
      statement.specifiers.some(
        (spec: BabelNode) =>
          (spec.exported.name ?? spec.exported.value) === "default",
      )
    ) {
      value = "unknown";
    }
  }
  if (value === "unknown" || value?.type !== "Identifier") return value;
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      FUNCTIONS.has(declaration?.type) &&
      declaration.id?.name === value.name
    ) {
      return declaration;
    }
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type === "Identifier" &&
        declarator.id.name === value.name
      ) {
        return unwrap(declarator.init) ?? value;
      }
    }
  }
  return value;
}

/**
 * The options object an action module passes to `defineAction`, `"unknown"`
 * when the parser can't tell what they are, or null for a module that
 * defines no action.
 */
function actionOptions(program: BabelNode): BabelNode | "unknown" | null {
  const names = new Set(["defineAction"]);
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const spec of statement.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      if ((spec.imported.name ?? spec.imported.value) === "defineAction") {
        names.add(spec.local.name);
      }
    }
  }
  const calls: BabelNode[] = [];
  forEachNode(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrap(node.callee);
    if (
      (callee?.type === "Identifier" && names.has(callee.name)) ||
      (callee?.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.name === "defineAction")
    ) {
      calls.push(node);
    }
  });
  const exported = exportedValue(program);
  const call =
    calls.length === 1 ? calls[0] : calls.find((c) => c === exported);
  if (call) return unwrap(call.arguments[0]) ?? "unknown";
  if (calls.length > 0 || exported === "unknown") return "unknown";
  if (!exported || FUNCTIONS.has(exported.type)) return null;
  return exported.type === "ObjectExpression" ? exported : "unknown";
}

/** The flags an options object sets, read in order the way JavaScript would. */
function readOptionFlags(options: BabelNode | "unknown"): ReadFlags {
  if (options === "unknown" || options.type !== "ObjectExpression") {
    return { ...UNKNOWN_FLAGS };
  }
  const flags: ReadFlags = {};
  for (const prop of options.properties) {
    const name = prop.type === "SpreadElement" ? null : propertyName(prop);
    if (name === null) {
      // A spread or a computed key can set any flag.
      Object.assign(flags, UNKNOWN_FLAGS);
    } else if ((READ_FLAGS as readonly string[]).includes(name)) {
      const value =
        prop.type === "ObjectProperty" ? unwrap(prop.value) : undefined;
      flags[name as ReadFlag] =
        value?.type === "BooleanLiteral" ? value.value : "unknown";
    }
  }
  return flags;
}

/**
 * The flags the dev scan reads from an action's source when it can't import
 * the module and falls back to running it through `pnpm action`. It parses
 * the source rather than running it, so it errs toward the safe side: only a
 * literal `needsApproval: false` skips the approval gate, and only a literal
 * `persistInBrowser: true` lets the browser keep results. Any other value,
 * options it can't see (spread in, passed by name, built by another helper or
 * re-exported), or a source it can't parse asks every time and keeps results
 * out of the browser's storage. A module that defines no action gets neither.
 */
export function cliWrapperFlagsFromSource(src: string): CliWrapperFlags {
  const out: CliWrapperFlags = {};
  const program = parseProgram(src);
  const options = program ? actionOptions(program) : "unknown";
  if (options !== null) {
    const flags = readOptionFlags(options);
    if (flags.needsApproval !== undefined && flags.needsApproval !== false) {
      out.needsApproval = true;
    }
    if (
      flags.persistInBrowser !== undefined &&
      flags.persistInBrowser !== true
    ) {
      out.persistInBrowser = false;
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
