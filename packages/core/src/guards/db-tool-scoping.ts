/**
 * scanDbToolScoping — ported from `scripts/guard-db-tool-scoping.mjs`.
 *
 * The agent's raw DB tools (`db-query`, `db-exec`, `db-patch`) can only
 * safely expose tables with an explicit tenant scope (`owner_email` and/or
 * `org_id`) or a documented, reviewed exception. This guard keeps schema
 * drift visible: any table without raw-DB scope must either add
 * `owner_email`/`org_id`, or be added to the denylist with a
 * reviewer-readable reason.
 *
 * Conditional guard — per report 005's V1 guard set table: the original
 * walks every `templates/*\/server/db/schema.ts` and keys its denylist
 * `"<template>:<table>"`. A generated app has exactly one
 * `server/db/schema.ts` (confirmed convention), so this port scans that
 * single file and uses bare `"<table>"` denylist keys. The denylist itself
 * comes from `agent-native.json`'s `doctor.dbToolScopingDenylist` (see
 * `../cli/doctor.ts`) — empty by default; app authors add entries with the
 * same reviewer-readable-reason convention as the original constant.
 *
 * Not ported: the original also resolves `export * from
 * "@agent-native/<pkg>/schema"` re-exports back to that package's
 * `packages/<pkg>/src/schema/*.ts` monorepo source, so template schemas
 * that re-export scheduling/dispatch tables get scanned too. In a
 * generated app those packages are compiled `node_modules` output (no
 * `.ts` source to brace-parse), and report 005's parameterization note
 * doesn't cover that case, so re-export resolution is intentionally
 * dropped for app mode: a re-exported table from an `@agent-native/*`
 * package is not scanned here (false-negative, not false-positive) — see
 * the plan's STOP-condition guidance ("report rather than invent new
 * detection logic").
 */

import { parse } from "@babel/parser";

import { readFileSafe, relPosix, walk } from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

export interface DbToolScopingOptions extends GuardScanOptions {
  denylist?: Record<string, string>;
}

interface TableCall {
  exportName: string;
  sqlName: string;
  body: string;
}

function extractTableCalls(contents: string): TableCall[] {
  const out: TableCall[] = [];
  const headerRegex =
    /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:[a-zA-Z_$][\w$]*Table|table)\s*\(\s*"([^"]+)"\s*,\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(contents)) !== null) {
    const exportName = match[1];
    const sqlName = match[2];
    const start = headerRegex.lastIndex - 1;
    let depth = 0;
    let inStr: string | null = null;
    let bodyEnd = -1;
    for (let i = start; i < contents.length; i++) {
      const c = contents[i];
      const prev = contents[i - 1];
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd === -1) continue;
    out.push({ exportName, sqlName, body: contents.slice(start + 1, bodyEnd) });
  }
  return out;
}

function hasRawDbScope(tableBody: string): boolean {
  return (
    /\.\.\.ownableColumns\s*\(/.test(tableBody) ||
    /\b[\w$]+\s*:\s*text\s*\(\s*["']owner_email["']/.test(tableBody) ||
    /\b[\w$]+\s*:\s*text\s*\(\s*["']org_id["']/.test(tableBody)
  );
}

/** Recognize only a local, parameterless object factory whose bound framework
 * ownableColumns import survives all later object properties/spreads. */
function composedScopedTables(contents: string): Set<string> {
  const accepted = new Set<string>();
  try {
    const ast = parse(contents, {
      sourceType: "module",
      plugins: ["typescript"],
    });
    const program = ast.program.body;
    const ownable = new Set<string>();
    type Statement = (typeof program)[number];
    type FunctionDecl = Extract<Statement, { type: "FunctionDeclaration" }>;
    type ReturnStmt = Extract<
      FunctionDecl["body"]["body"][number],
      { type: "ReturnStatement" }
    >;
    type ObjectExpr = Extract<
      NonNullable<ReturnStmt["argument"]>,
      { type: "ObjectExpression" }
    >;
    const helpers = new Map<string, ObjectExpr>();
    const bindings = new Map<string, number>();
    const modified = new Set<string>();
    const bind = (name: string) =>
      bindings.set(name, (bindings.get(name) ?? 0) + 1);
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === "object";
    const markTarget = (target: unknown): void => {
      if (!object(target)) return;
      if (target.type === "Identifier" && typeof target.name === "string") {
        modified.add(target.name);
      } else if (target.type === "RestElement") markTarget(target.argument);
      else if (target.type === "AssignmentPattern") markTarget(target.left);
      else if (target.type === "ArrayPattern" && Array.isArray(target.elements))
        target.elements.forEach(markTarget);
      else if (
        target.type === "ObjectPattern" &&
        Array.isArray(target.properties)
      )
        target.properties.forEach((p: unknown) => {
          if (object(p))
            markTarget(p.type === "RestElement" ? p.argument : p.value);
        });
    };
    const bindPattern = (target: unknown): void => {
      if (!object(target)) return;
      if (target.type === "Identifier" && typeof target.name === "string")
        bind(target.name);
      else if (target.type === "RestElement") bindPattern(target.argument);
      else if (target.type === "AssignmentPattern") bindPattern(target.left);
      else if (target.type === "ArrayPattern" && Array.isArray(target.elements))
        target.elements.forEach(bindPattern);
      else if (
        target.type === "ObjectPattern" &&
        Array.isArray(target.properties)
      )
        target.properties.forEach((p: unknown) => {
          if (object(p))
            bindPattern(p.type === "RestElement" ? p.argument : p.value);
        });
    };
    const visit = (node: unknown): void => {
      if (!object(node)) return;
      if (
        (node.type === "ImportSpecifier" ||
          node.type === "ImportDefaultSpecifier" ||
          node.type === "ImportNamespaceSpecifier") &&
        object(node.local) &&
        typeof node.local.name === "string"
      )
        bind(node.local.name);
      if (
        node.type === "FunctionDeclaration" &&
        object(node.id) &&
        typeof node.id.name === "string"
      )
        bind(node.id.name);
      if (node.type === "VariableDeclarator") bindPattern(node.id);
      if (
        (node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression") &&
        Array.isArray(node.params)
      )
        node.params.forEach(bindPattern);
      if (node.type === "CatchClause") bindPattern(node.param);
      if (node.type === "AssignmentExpression") markTarget(node.left);
      if (node.type === "UpdateExpression") markTarget(node.argument);
      if (
        (node.type === "ForOfStatement" || node.type === "ForInStatement") &&
        object(node.left) &&
        node.left.type !== "VariableDeclaration"
      )
        markTarget(node.left);
      for (const [key, value] of Object.entries(node)) {
        if (
          ["loc", "start", "end", "extra", "comments", "tokens"].includes(key)
        )
          continue;
        if (Array.isArray(value)) value.forEach(visit);
        else if (object(value)) visit(value);
      }
    };
    visit(ast.program);
    for (const stmt of program) {
      if (
        stmt.type === "ImportDeclaration" &&
        stmt.source.value === "@agent-native/core/db/schema"
      ) {
        for (const spec of stmt.specifiers)
          if (
            spec.type === "ImportSpecifier" &&
            spec.imported.type === "Identifier" &&
            spec.imported.name === "ownableColumns" &&
            stmt.importKind !== "type" &&
            spec.importKind !== "type"
          )
            ownable.add(spec.local.name);
      }
      const decl =
        stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      const onlyStatement =
        decl?.type === "FunctionDeclaration" && decl.body.body.length === 1
          ? decl.body.body[0]
          : undefined;
      if (
        decl?.type === "FunctionDeclaration" &&
        decl.id &&
        !decl.async &&
        !decl.generator &&
        decl.params.length === 0 &&
        onlyStatement?.type === "ReturnStatement" &&
        onlyStatement.argument?.type === "ObjectExpression"
      )
        helpers.set(decl.id.name, onlyStatement.argument);
    }
    const unique = (name: string) =>
      bindings.get(name) === 1 && !modified.has(name);
    const scoped = (object: ObjectExpr, stack: Set<string>): boolean => {
      let safe = false;
      for (const prop of object.properties) {
        if (prop.type === "SpreadElement") {
          const call = prop.argument;
          if (
            call.type !== "CallExpression" ||
            call.arguments.length !== 0 ||
            call.callee.type !== "Identifier"
          )
            return false;
          const name = call.callee.name;
          if (!unique(name)) return false;
          if (ownable.has(name)) {
            safe = true;
            continue;
          }
          const helper = helpers.get(name);
          if (!helper || stack.has(name)) return false;
          const next = new Set(stack);
          next.add(name);
          if (!scoped(helper, next)) return false;
          safe = true;
          continue;
        }
        if (prop.type !== "ObjectProperty" || prop.computed) return false;
        const key =
          prop.key.type === "Identifier"
            ? prop.key.name
            : prop.key.type === "StringLiteral"
              ? prop.key.value
              : null;
        if (!key || key === "ownerEmail" || key === "orgId") return false;
      }
      return safe;
    };
    for (const stmt of program) {
      if (
        stmt.type !== "ExportNamedDeclaration" ||
        stmt.declaration?.type !== "VariableDeclaration"
      )
        continue;
      for (const decl of stmt.declaration.declarations) {
        const call = decl.init;
        if (
          decl.id.type !== "Identifier" ||
          call?.type !== "CallExpression" ||
          call.callee.type !== "Identifier" ||
          !/(?:Table|^table)$/.test(call.callee.name) ||
          call.arguments[0]?.type !== "StringLiteral" ||
          call.arguments[1]?.type !== "ObjectExpression"
        )
          continue;
        if (scoped(call.arguments[1], new Set()))
          accepted.add(decl.id.name + "\0" + call.arguments[0].value);
      }
    }
  } catch {
    // coercion-ok: unsupported syntax is not proof of scope; unaccepted tables stay flagged.
  }
  return accepted;
}

export function scanDbToolScoping(options: DbToolScopingOptions): GuardResult {
  const { root, denylist = {} } = options;
  const findings: GuardFinding[] = [];
  const seenAllowed = new Set<string>();

  for (const file of walk(root)) {
    if (!file.endsWith("/server/db/schema.ts")) continue;
    const contents = readFileSafe(file);
    if (contents === null) continue;
    const rel = relPosix(root, file);
    const tables = extractTableCalls(contents);
    const composed = composedScopedTables(contents);
    for (const table of tables) {
      if (
        hasRawDbScope(table.body) ||
        composed.has(table.exportName + "\0" + table.sqlName)
      )
        continue;
      if (Object.prototype.hasOwnProperty.call(denylist, table.sqlName)) {
        seenAllowed.add(table.sqlName);
        continue;
      }
      findings.push({
        file: rel,
        line: 1,
        message: `Table "${table.sqlName}" (export ${table.exportName}) has no owner_email/org_id scope and is not on the doctor.dbToolScopingDenylist — add tenant scope, or add it to agent-native.json's "doctor.dbToolScopingDenylist" with a reason.`,
      });
    }
  }

  for (const key of Object.keys(denylist)) {
    if (!seenAllowed.has(key)) {
      findings.push({
        file: "agent-native.json",
        line: 1,
        message: `Stale doctor.dbToolScopingDenylist entry "${key}" — no matching table found in server/db/schema.ts. Remove it.`,
      });
    }
  }

  return { name: "db-tool-scoping", findings };
}
