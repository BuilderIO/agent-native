import ts from "typescript";

import type { Edits } from "./edits.ts";
import { attrName, containsJsx, hasSpread, type JsxTag } from "./jsx.ts";
import type { Analysis, ComponentDef, SiteContext } from "./types.ts";

const STATUS: Readonly<Record<string, string[]>> = {
  "": [],
  message: [],
  success: ['color: "success"'],
  error: ['color: "danger"'],
  warning: ['color: "warning"'],
  info: ['color: "info"'],
  loading: ['type: "loading"'],
};

const KEPT_OPTIONS = new Set(["description", "id"]);
const DROPPED_OPTIONS = new Set(["closeButton", "richColors", "position"]);
const DROPPED_BEHAVIOR: Readonly<Record<string, string>> = {
  position: "dropped position: toasts now sit in the bottom-right viewport",
};

function skip(reason: string): Analysis {
  return { ok: false, reason };
}

function isPlainMessage(node: ts.Expression): boolean {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node) ||
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
  ) {
    return !containsJsx(node);
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return isPlainMessage(node.expression);
  }
  if (ts.isNonNullExpression(node)) return isPlainMessage(node.expression);
  if (ts.isConditionalExpression(node)) {
    return isPlainMessage(node.whenTrue) && isPlainMessage(node.whenFalse);
  }
  if (ts.isBinaryExpression(node)) {
    return isPlainMessage(node.left) && isPlainMessage(node.right);
  }
  return false;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function isInfinity(node: ts.Expression): boolean {
  const text = node.getText().replace(/\s/g, "");
  return text === "Infinity" || text === "Number.POSITIVE_INFINITY";
}

type HandlerPlan =
  | { kind: "none" }
  | {
      kind: "block";
      handler: ts.ArrowFunction | ts.FunctionExpression;
      body: ts.Block;
    }
  | {
      kind: "expression";
      handler: ts.ArrowFunction | ts.FunctionExpression;
      body: ts.Expression;
    }
  | { kind: "reference"; handler: ts.Expression; passEvent: boolean };

function localParameterCount(
  handler: ts.Identifier,
  checker: ts.TypeChecker,
): number | null {
  const declaration = checker.getSymbolAtLocation(handler)?.valueDeclaration;
  if (!declaration) return null;
  if (ts.isFunctionDeclaration(declaration)) {
    return declaration.parameters.length;
  }
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer.parameters.length;
  }
  return null;
}

function planHandler(
  value: ts.Expression | undefined,
  checker: ts.TypeChecker,
): HandlerPlan | { error: string } {
  if (value === undefined) return { kind: "none" };
  if (value.getText().includes("preventDefault")) {
    return { error: "it calls preventDefault to keep the toast open" };
  }
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return ts.isBlock(value.body)
      ? { kind: "block", handler: value, body: value.body }
      : { kind: "expression", handler: value, body: value.body };
  }
  if (ts.isIdentifier(value)) {
    const count = localParameterCount(value, checker);
    if (count === null) {
      return {
        error:
          "its onClick is a reference whose parameters aren't declared in this file",
      };
    }
    return { kind: "reference", handler: value, passEvent: count > 0 };
  }
  return { error: "its onClick isn't a function or a reference to one" };
}

function buildHandler(plan: HandlerPlan, close: string, edits: Edits): string {
  switch (plan.kind) {
    case "none":
      return `() => ${close}`;
    case "reference":
      return `(${plan.passEvent ? "event" : ""}) => { ${close}; ${edits.slice(plan.handler.getStart(), plan.handler.end)}(${plan.passEvent ? "event" : ""}); }`;
    case "block": {
      const open = plan.body.getStart() + 1;
      edits.add(open, open, ` ${close};`);
      return edits.slice(plan.handler.getStart(), plan.handler.end);
    }
    case "expression": {
      const body = edits.slice(plan.body.getStart(), plan.body.end);
      const head = edits.slice(plan.handler.getStart(), plan.body.getStart());
      return `${head}{ ${close}; ${body}; }`;
    }
  }
}

interface ButtonOption {
  key: "action" | "cancel";
  property: ts.ObjectLiteralElementLike;
  label: ts.Expression | "shorthand";
  plan: HandlerPlan;
}

function readButtonOption(
  property: ts.ObjectLiteralElementLike,
  key: "action" | "cancel",
  checker: ts.TypeChecker,
): ButtonOption | { error: string } {
  if (!ts.isPropertyAssignment(property)) {
    return { error: `${key} isn't { label, onClick }` };
  }
  const value = property.initializer;
  if (!ts.isObjectLiteralExpression(value)) {
    return { error: `${key} isn't { label, onClick }` };
  }
  let label: ts.Expression | "shorthand" | undefined;
  let onClick: ts.Expression | undefined;
  for (const inner of value.properties) {
    const name = propertyName(inner);
    if (name === "label" && ts.isPropertyAssignment(inner)) {
      label = inner.initializer;
    } else if (name === "label" && ts.isShorthandPropertyAssignment(inner)) {
      label = "shorthand";
    } else if (name === "onClick" && ts.isPropertyAssignment(inner)) {
      onClick = inner.initializer;
    } else if (name === "onClick" && ts.isShorthandPropertyAssignment(inner)) {
      onClick = inner.name;
    } else if (name === "onClick" && ts.isMethodDeclaration(inner)) {
      return { error: `${key}.onClick is a method` };
    } else {
      return { error: `${key} has \`${name ?? inner.getText()}\`` };
    }
  }
  if (label === undefined) return { error: `${key} has no label` };
  const plan = planHandler(onClick, checker);
  if ("error" in plan) return { error: `${key}: ${plan.error}` };
  return { key, property, label, plan };
}

const STATEMENT_PARENTS = new Set([
  ts.SyntaxKind.Block,
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.ModuleBlock,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
]);

type IdPlan =
  | { kind: "option"; text: string }
  | { kind: "variable"; name: string }
  | { kind: "declare"; statement: ts.ExpressionStatement };

function planId(
  call: ts.CallExpression,
  idProperty: ts.ObjectLiteralElementLike | undefined,
): IdPlan | null {
  if (idProperty) {
    if (ts.isShorthandPropertyAssignment(idProperty)) {
      return { kind: "option", text: idProperty.name.text };
    }
    if (
      ts.isPropertyAssignment(idProperty) &&
      (ts.isIdentifier(idProperty.initializer) ||
        ts.isStringLiteral(idProperty.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(idProperty.initializer))
    ) {
      return { kind: "option", text: idProperty.initializer.getText() };
    }
    return null;
  }
  const parent = call.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === call &&
    ts.isIdentifier(parent.name)
  ) {
    return { kind: "variable", name: parent.name.text };
  }
  if (
    ts.isExpressionStatement(parent) &&
    STATEMENT_PARENTS.has(parent.parent.kind)
  ) {
    return { kind: "declare", statement: parent };
  }
  return null;
}

function analyzeAdd(
  call: ts.CallExpression,
  method: string,
  context: SiteContext,
): Analysis {
  const message = call.arguments.at(0);
  const options = call.arguments.at(1);
  const extra = call.arguments.slice(2);
  if (message === undefined) return skip("toast with no message");
  if (extra.length > 0) return skip("more than two arguments");
  if (call.arguments.some(ts.isSpreadElement)) return skip("spread arguments");
  if (!isPlainMessage(message)) {
    return skip("first argument isn't a plain message expression");
  }
  if (options !== undefined && !ts.isObjectLiteralExpression(options)) {
    return skip("options aren't an object literal");
  }
  const properties = options ? [...options.properties] : [];
  const buttons: ButtonOption[] = [];
  const handled = new Map<ts.ObjectLiteralElementLike, "keep" | "drop">();
  let idProperty: ts.ObjectLiteralElementLike | undefined;
  let closeHandler: ts.ObjectLiteralElementLike | undefined;
  const unsupported: string[] = [];
  const reviews: string[] = [];
  for (const property of properties) {
    if (ts.isSpreadAssignment(property)) return skip("options spread");
    const name = propertyName(property);
    if (name === null) return skip("computed option name");
    if (ts.isMethodDeclaration(property)) {
      return skip(`option \`${name}\` is a method`);
    }
    if (KEPT_OPTIONS.has(name)) {
      if (name === "id") idProperty = property;
      handled.set(property, "keep");
    } else if (DROPPED_OPTIONS.has(name)) {
      handled.set(property, "drop");
      const behavior = DROPPED_BEHAVIOR[name];
      if (behavior) reviews.push(behavior);
    } else if (name === "duration") {
      if (
        ts.isPropertyAssignment(property) &&
        !isInfinity(property.initializer) &&
        /\bInfinity\b/.test(property.initializer.getText())
      ) {
        return skip("duration mixes Infinity into an expression");
      }
      handled.set(property, "keep");
    } else if (name === "important") {
      if (
        !ts.isPropertyAssignment(property) ||
        (property.initializer.kind !== ts.SyntaxKind.TrueKeyword &&
          property.initializer.kind !== ts.SyntaxKind.FalseKeyword)
      ) {
        return skip("important isn't true or false");
      }
      handled.set(property, "keep");
    } else if (name === "onDismiss" || name === "onAutoClose") {
      if (closeHandler) return skip("both onDismiss and onAutoClose");
      if (!ts.isPropertyAssignment(property)) {
        return skip(`${name} isn't an inline function`);
      }
      const value = property.initializer;
      if (!(ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
        return skip(
          `${name} isn't an inline function, so whether it reads the toast is unknown`,
        );
      }
      if (value.parameters.length > 0) {
        return skip(`${name} reads the toast; onClose passes nothing`);
      }
      closeHandler = property;
      handled.set(property, "keep");
    } else if (name === "action" || name === "cancel") {
      const button = readButtonOption(property, name, context.checker);
      if ("error" in button) return skip(button.error);
      buttons.push(button);
      handled.set(property, "keep");
    } else {
      unsupported.push(name);
    }
  }
  if (unsupported.length > 0) {
    return skip(
      `option${unsupported.length > 1 ? "s" : ""} ${unsupported.map((name) => `\`${name}\``).join(", ")}`,
    );
  }
  let idPlan: IdPlan | null = null;
  if (buttons.length > 0) {
    idPlan = planId(call, idProperty);
    if (!idPlan) {
      return skip(
        "action/cancel must close the toast by id, and the call's result isn't a statement, a variable or an `id` option",
      );
    }
  }
  const callee = call.expression;
  const toastName = ts.isPropertyAccessExpression(callee)
    ? callee.expression.getText()
    : callee.getText();
  return {
    ok: true,
    uses: [{ imported: "toast", local: context.local }],
    reviews,
    build(edits) {
      let idText = "";
      if (idPlan?.kind === "option") idText = idPlan.text;
      else if (idPlan?.kind === "variable") idText = idPlan.name;
      else if (idPlan?.kind === "declare") idText = context.fresh("toastId");
      const close = `${toastName}.close(${idText})`;
      const fields = [
        `title: ${edits.slice(message.getStart(), message.end)}`,
        ...(STATUS[method] ?? []),
      ];
      for (const property of properties) {
        if (handled.get(property) === "drop") continue;
        const name = propertyName(property) ?? "";
        const value = ts.isPropertyAssignment(property)
          ? property.initializer
          : undefined;
        const valueText = () =>
          value ? edits.slice(value.getStart(), value.end) : name;
        const button = buttons.find((entry) => entry.property === property);
        if (button) {
          const label =
            button.label === "shorthand"
              ? "label"
              : edits.slice(button.label.getStart(), button.label.end);
          const onClick = buildHandler(button.plan, close, edits);
          const key =
            name === "action" ? "actionProps" : "secondaryActionProps";
          fields.push(`${key}: { children: ${label}, onClick: ${onClick} }`);
        } else if (name === "duration") {
          fields.push(
            `timeout: ${value && isInfinity(value) ? "0" : valueText()}`,
          );
        } else if (name === "important") {
          if (value?.kind === ts.SyntaxKind.TrueKeyword) {
            fields.push('priority: "high"');
          }
        } else if (name === "onDismiss" || name === "onAutoClose") {
          fields.push(`onClose: ${valueText()}`);
        } else {
          fields.push(
            ts.isShorthandPropertyAssignment(property)
              ? name
              : `${name}: ${valueText()}`,
          );
        }
      }
      const text = `${toastName}.add({ ${fields.join(", ")} })`;
      const start =
        idPlan?.kind === "declare"
          ? idPlan.statement.getStart()
          : call.getStart();
      edits.slice(start, call.end);
      edits.add(
        start,
        call.end,
        idPlan?.kind === "declare" ? `const ${idText} = ${text}` : text,
      );
    },
  };
}

function toastReference(
  identifier: ts.Identifier,
  context: SiteContext,
): Analysis {
  if (context.imported !== "toast" && context.imported !== "sonnerToast") {
    return skip(`\`${context.imported}\` used outside JSX`);
  }
  const parent = identifier.parent;
  if (ts.isCallExpression(parent) && parent.expression === identifier) {
    return analyzeAdd(parent, "", context);
  }
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === identifier &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    const method = parent.name.text;
    const call = parent.parent;
    if (method === "dismiss") {
      if (call.arguments.length > 1) return skip("dismiss with two arguments");
      return {
        ok: true,
        uses: [{ imported: "toast", local: context.local }],
        reviews: [],
        build(edits) {
          edits.add(parent.name.getStart(), parent.name.end, "close");
        },
      };
    }
    if (method in STATUS) return analyzeAdd(call, method, context);
    return skip(`toast.${method}`);
  }
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === identifier
  ) {
    return skip(
      `toast.${parent.name.text} used as a value, not called${asMock(context)}`,
    );
  }
  if (
    ts.isElementAccessExpression(parent) &&
    parent.expression === identifier
  ) {
    return skip("toast[…] picks its method at runtime");
  }
  return skip(`toast used as a value, not called${asMock(context)}`);
}

function asMock(context: SiteContext): string {
  return /\.(spec|test)\.[cm]?[jt]sx?$|\/__tests__\//.test(
    context.source.fileName,
  )
    ? " (a test reading sonner's mock: assert on toast.add instead)"
    : "";
}

const TOASTER_DROPPED = new Set([
  "position",
  "richColors",
  "closeButton",
  "theme",
]);
const TOASTER_REVIEWED = new Set(["offset", "mobileOffset"]);
const TOASTER_RENAMED: Readonly<Record<string, string>> = {
  visibleToasts: "limit",
};

function freeIdentifiers(attributes: string): string[] | null {
  const source = ts.createSourceFile(
    "toaster-props.tsx",
    `<X ${attributes} />`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = source.statements.at(0);
  if (
    source.statements.length !== 1 ||
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isJsxSelfClosingElement(statement.expression)
  ) {
    return null;
  }
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      !(
        ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      ) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !ts.isJsxAttribute(node.parent)
    ) {
      names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(statement.expression.attributes);
  return [...names];
}

function toasterJsx(tag: JsxTag, context: SiteContext): Analysis {
  if (context.imported !== "Toaster") {
    return skip(`<${context.imported}> has no counterpart`);
  }
  const props = context.options.toasterProps;
  if (!props) {
    return skip(
      "the new Toaster needs its localized labels: pass --toaster-props",
    );
  }
  const names = freeIdentifiers(props);
  if (!names) return skip("--toaster-props aren't JSX attributes");
  const inScope = new Set(
    context.checker
      .getSymbolsInScope(tag, ts.SymbolFlags.Value)
      .map((symbol) => symbol.name),
  );
  const missing = names.filter((name) => !inScope.has(name));
  if (missing.length > 0) {
    return skip(
      `--toaster-props read ${missing.join(", ")}, not in scope here`,
    );
  }
  if (hasSpread(tag)) return skip("spread props on the Toaster");
  const reviews = [
    "toolkit and core still raise sonner toasts: keep a sonner Toaster mounted beside this one until they move",
  ];
  const removed: ts.JsxAttribute[] = [];
  const renamed: [ts.JsxAttribute, string][] = [];
  for (const property of tag.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const name = attrName(property);
    if (TOASTER_DROPPED.has(name)) {
      removed.push(property);
      const behavior = DROPPED_BEHAVIOR[name];
      if (behavior) reviews.push(behavior);
    } else if (TOASTER_REVIEWED.has(name)) {
      removed.push(property);
      reviews.push(
        `dropped ${name}: the new viewport's inset is the part's own`,
      );
    } else if (TOASTER_RENAMED[name]) {
      renamed.push([property, TOASTER_RENAMED[name]]);
    } else return skip(`Toaster prop \`${name}\``);
  }
  return {
    ok: true,
    uses: [{ imported: "Toaster", local: context.local }],
    reviews,
    build(edits) {
      for (const attribute of removed) {
        edits.add(attribute.getFullStart(), attribute.end, "");
      }
      for (const [attribute, name] of renamed) {
        edits.add(attribute.name.getStart(), attribute.name.end, name);
      }
      edits.add(tag.tagName.end, tag.tagName.end, ` ${props}`);
    },
  };
}

export function toastComponent(
  next: string,
  legacy: readonly string[],
): ComponentDef {
  return {
    name: "toast",
    legacy,
    next,
    names: { toast: "toast", sonnerToast: "toast", Toaster: "Toaster" },
    jsx: toasterJsx,
    reference: toastReference,
  };
}
