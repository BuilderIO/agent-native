import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { requireAddedLines } from "./lib/changed-lines.mjs";

// Reviewed escape hatch for a legitimate non-chat host or a migration boundary:
//   // guard:allow-chat-send-gate - short reason
// Put it on the violation or the line immediately above it.
const CHAT_SEND_GATE_OPT_OUT = /\/\/\s*guard:allow-chat-send-gate\s*-\s*\S/u;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const AGENT_CHAT_BASE_ROUTE =
  /\/_agent-native\/agent-chat\/?(?:[?#][^\s"'`]*)?$/;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/i;
const TEST_FILE = /\.(?:spec|test)\.[^.]+$/i;
const SOURCE_ROOT = /^(?:apps|community-templates|packages|templates)\//;

// Shared transports may own low-level prompt POSTs, but they still have to
// prove readiness first. Background sessions are checked separately below.
const APPROVED_DISPATCH_FILES = new Set([
  "packages/core/src/client/chat/agentkit-agent-native.ts",
  "packages/core/src/client/chat/runtime.ts",
]);
const BACKGROUND_SESSION_FILE =
  "packages/core/src/client/background-agent-session.ts";
const AGENTKIT_CONTROLLER_FILE = "packages/agentkit/src/client/client.ts";
const CORE_RUNTIME_FILE = "packages/core/src/client/chat/runtime.ts";
const CORE_AGENTKIT_TRANSPORT_FILE =
  "packages/core/src/client/chat/agentkit-agent-native.ts";
const READINESS_MODULES = new Set([
  "packages/core/src/client/agent-engine-readiness.ts",
  "packages/core/src/client/use-agent-engine-configured.ts",
]);
const READINESS_ADAPTERS = new Set([
  ...READINESS_MODULES,
  // React Native needs an authenticated remote status source; this is the
  // app-specific adapter for the same shared module-level readiness store.
  "packages/mobile-app/lib/agent-chat/use-agent-chat.ts",
]);
export const CHAT_SEND_GATE_WHOLE_FILE_BOUNDARIES = [
  AGENTKIT_CONTROLLER_FILE,
  CORE_RUNTIME_FILE,
  CORE_AGENTKIT_TRANSPORT_FILE,
  BACKGROUND_SESSION_FILE,
] as const;
const STATUS_ROUTE_FILES = new Set([
  ...READINESS_MODULES,
  "packages/core/src/client/client-status-requests.ts",
  "packages/core/src/server/core-routes-plugin.ts",
  "packages/core/src/client/analytics.ts",
  "packages/toolkit/src/app/settings/SettingsPanel.tsx",
  "packages/toolkit/src/app/integrations/IntegrationsPanel.tsx",
  "packages/mobile-app/lib/agent-chat/api.ts",
  "templates/mail/app/lib/agent-generate.ts",
  "templates/clips/desktop/src/overlays/recording-pill.tsx",
]);

export interface ChatSendGateViolation {
  file: string;
  line: number;
  startLine: number;
  endLine: number;
  reason: string;
}

type RequestMethod = "GET" | "HEAD" | "OPTIONS" | "other" | "unknown";

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function lineAt(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function lineRange(node: ts.Node, sourceFile: ts.SourceFile) {
  return {
    start: lineAt(sourceFile, node.getStart(sourceFile)),
    end: lineAt(sourceFile, Math.max(node.getStart(sourceFile), node.end - 1)),
  };
}

function hasChatSendGateOptOut(source: string, startLine: number): boolean {
  const lines = source.split(/\r?\n/u);
  return [startLine - 1, startLine - 2].some((lineIndex) =>
    CHAT_SEND_GATE_OPT_OUT.test(lines[lineIndex] ?? ""),
  );
}

function isFalse(node: ts.Expression | undefined): boolean {
  return node !== undefined && node.kind === ts.SyntaxKind.FalseKeyword;
}

function propertyName(property: ts.PropertyName | undefined): string | null {
  if (!property) return null;
  if (ts.isIdentifier(property) || ts.isStringLiteral(property)) {
    return property.text;
  }
  return null;
}

function collectStringConstants(
  sourceFile: ts.SourceFile,
): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  return constants;
}

function staticString(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
  depth = 0,
): string | null {
  if (!expression || depth > 12) return null;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return null;
    const initializer = constants.get(expression.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(expression.text);
    return staticString(
      initializer,
      sourceFile,
      constants,
      nextSeen,
      depth + 1,
    );
  }
  if (ts.isParenthesizedExpression(expression)) {
    return staticString(
      expression.expression,
      sourceFile,
      constants,
      seen,
      depth + 1,
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(
      expression.left,
      sourceFile,
      constants,
      seen,
      depth + 1,
    );
    const right = staticString(
      expression.right,
      sourceFile,
      constants,
      seen,
      depth + 1,
    );
    return `${left ?? "<dynamic>"}${right ?? "<dynamic>"}`;
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      value +=
        staticString(span.expression, sourceFile, constants, seen, depth + 1) ??
        "<dynamic>";
      value += span.literal.text;
    }
    return value;
  }
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    if (
      (ts.isIdentifier(callee) &&
        ["agentNativePath", "normalizeEndpoint"].includes(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === "toString")
    ) {
      return staticString(
        expression.arguments[0],
        sourceFile,
        constants,
        seen,
        depth + 1,
      );
    }
  }
  if (ts.isNewExpression(expression)) {
    const constructor = expression.expression;
    if (
      ts.isIdentifier(constructor) &&
      (constructor.text === "URL" || constructor.text === "Request") &&
      expression.arguments?.[0]
    ) {
      return staticString(
        expression.arguments[0],
        sourceFile,
        constants,
        seen,
        depth + 1,
      );
    }
  }
  return null;
}

function hasAgentChatBaseRoute(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
): boolean {
  if (!expression) return false;
  const value = staticString(expression, sourceFile, constants);
  return AGENT_CHAT_BASE_ROUTE.test(value ?? expression.getText(sourceFile));
}

function collectInitConstants(
  sourceFile: ts.SourceFile,
): Map<string, ts.ObjectLiteralExpression> {
  const constants = new Map<string, ts.ObjectLiteralExpression>();
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  return constants;
}

function fetchExpression(
  node: ts.Expression,
  aliases: ReadonlySet<string> = new Set(["fetch"]),
): boolean {
  if (ts.isIdentifier(node)) return aliases.has(node.text);
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "fetch" &&
    (node.expression.getText() === "window" ||
      node.expression.getText() === "globalThis")
  );
}

function fetchAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>(["fetch"]);
  let changed = true;
  while (changed) {
    changed = false;
    const collect = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        fetchExpression(node.initializer, aliases) &&
        !aliases.has(node.name.text)
      ) {
        aliases.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
  }
  return aliases;
}

function isFetchLike(
  expression: ts.Expression,
  fetchNames: ReadonlySet<string>,
): boolean {
  if (ts.isIdentifier(expression)) {
    return (
      fetchNames.has(expression.text) ||
      /(?:fetch|request|send|submit|dispatch|post)/iu.test(expression.text)
    );
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      fetchNames.has(expression.name.text) ||
      /^(?:fetch|request|send|post|get|head|options)$/iu.test(
        expression.name.text,
      )
    );
  }
  return false;
}

function routeArgument(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  stringConstants: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  const argumentsWithUrlProperties = call.arguments.flatMap((argument) => {
    if (!ts.isObjectLiteralExpression(argument)) return [];
    return argument.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) return [];
      const name = propertyName(property.name);
      return name === "url" || name === "path" || name === "endpoint"
        ? [property.initializer]
        : [];
    });
  });
  return [...call.arguments, ...argumentsWithUrlProperties].find((argument) =>
    hasAgentChatBaseRoute(argument, sourceFile, stringConstants),
  );
}

function requestInitObject(
  expression: ts.Expression | undefined,
  initConstants: ReadonlyMap<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isIdentifier(expression) && initConstants.has(expression.text)) {
    return initConstants.get(expression.text);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return requestInitObject(expression.expression, initConstants);
  }
  return undefined;
}

function requestMethod(
  fetchCall: ts.CallExpression,
  initConstants: ReadonlyMap<string, ts.ObjectLiteralExpression>,
): RequestMethod {
  let init = requestInitObject(fetchCall.arguments[1], initConstants);
  const first = fetchCall.arguments[0];
  if (!init && first && ts.isNewExpression(first)) {
    const constructor = first.expression;
    if (ts.isIdentifier(constructor) && constructor.text === "Request") {
      init = requestInitObject(first.arguments?.[1], initConstants);
    }
  }
  if (!init) {
    return fetchCall.arguments.length < 2 ? "GET" : "unknown";
  }

  let method: string | null = null;
  let hasBody = false;
  let hasSpread = false;
  for (const property of init.properties) {
    if (ts.isSpreadAssignment(property)) {
      hasSpread = true;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (name === "body") hasBody = true;
    if (name === "method") {
      const initializer = property.initializer;
      if (
        ts.isStringLiteral(initializer) ||
        ts.isNoSubstitutionTemplateLiteral(initializer)
      ) {
        method = initializer.text.toUpperCase();
      } else {
        return "unknown";
      }
    }
  }

  if (method === "GET") return "GET";
  if (method === "HEAD") return "HEAD";
  if (method === "OPTIONS") return "OPTIONS";
  if (method !== null) return "other";
  if (hasBody || hasSpread) return "unknown";
  return "GET";
}

function requestCallMethod(
  call: ts.CallExpression,
  initConstants: ReadonlyMap<string, ts.ObjectLiteralExpression>,
  fetchNames: ReadonlySet<string>,
): RequestMethod {
  const methodName = ts.isIdentifier(call.expression)
    ? call.expression.text.toLowerCase()
    : ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text.toLowerCase()
      : "";
  if (
    methodName === "get" ||
    methodName === "head" ||
    methodName === "options"
  ) {
    return methodName.toUpperCase() as RequestMethod;
  }
  if (
    methodName === "post" ||
    methodName === "put" ||
    methodName === "patch" ||
    methodName === "delete"
  ) {
    return "other";
  }
  if (
    call.arguments.length === 1 &&
    methodName.includes("request") &&
    methodName !== "jsonrequest"
  ) {
    return "unknown";
  }
  if (
    call.arguments.length === 1 &&
    methodName.includes("fetch") &&
    !fetchNames.has(methodName)
  ) {
    return "unknown";
  }
  if (
    call.arguments.length === 1 &&
    /(?:send|submit|dispatch|post)/iu.test(methodName)
  ) {
    return "unknown";
  }

  const first = call.arguments[0];
  if (first && ts.isObjectLiteralExpression(first)) {
    const request = requestInitObject(first, initConstants);
    if (request) {
      for (const property of request.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        if (name === "method") {
          const initializer = property.initializer;
          if (
            ts.isStringLiteral(initializer) ||
            ts.isNoSubstitutionTemplateLiteral(initializer)
          ) {
            const method = initializer.text.toUpperCase();
            if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
              return method;
            }
            return "other";
          }
          return "unknown";
        }
      }
      if (
        request.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            propertyName(property.name) === "body",
        )
      ) {
        return "other";
      }
    }
  }

  const methodArgument = call.arguments.find(
    (argument) =>
      ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument),
  );
  if (methodArgument && methodArgument.text.toUpperCase() === "GET") {
    return "GET";
  }
  if (methodArgument && methodArgument.text.toUpperCase() === "HEAD") {
    return "HEAD";
  }
  if (methodArgument && methodArgument.text.toUpperCase() === "OPTIONS") {
    return "OPTIONS";
  }
  if (
    methodArgument &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(
      methodArgument.text.toUpperCase(),
    )
  ) {
    return "other";
  }
  return requestMethod(call, initConstants);
}

function hasDispatchReadinessBefore(
  dispatch: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const containsDispatch = (node: ts.Node): boolean => {
    let parent: ts.Node | undefined = dispatch;
    while (parent) {
      if (parent === node) return true;
      parent = parent.parent;
    }
    return false;
  };

  let owner: ts.Node | undefined = dispatch.parent;
  while (owner) {
    if (ts.isFunctionLike(owner) && owner.body) {
      let found = false;
      const inspect = (node: ts.Node) => {
        if (
          node !== owner &&
          ts.isFunctionLike(node) &&
          !containsDispatch(node)
        ) {
          return;
        }
        if (
          ts.isCallExpression(node) &&
          ((ts.isIdentifier(node.expression) &&
            node.expression.text ===
              "requireAgentEngineConfiguredForDispatch") ||
            (ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "assertAiSetupReady")) &&
          node.getStart(sourceFile) < dispatch.getStart(sourceFile)
        ) {
          found = true;
          return;
        }
        if (!found) ts.forEachChild(node, inspect);
      };
      inspect(owner.body);
      if (found) return true;
    }
    owner = owner.parent;
  }
  return false;
}

function classMethod(
  sourceFile: ts.SourceFile,
  className: string,
  methodName: string,
): ts.MethodDeclaration | undefined {
  let result: ts.MethodDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isMethodDeclaration(node) &&
      propertyName(node.name) === methodName &&
      ts.isClassLike(node.parent) &&
      propertyName(node.parent.name) === className
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function awaitedMemberCallPosition(
  body: ts.Node,
  memberName: string,
  sourceFile: ts.SourceFile,
): number | undefined {
  let result: number | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isAwaitExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === memberName
    ) {
      result = Math.min(result ?? Infinity, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return result;
}

function memberAccessPosition(
  body: ts.Node,
  ownerName: string,
  memberName: string,
  sourceFile: ts.SourceFile,
): number | undefined {
  let result: number | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === memberName &&
      node.expression.getText(sourceFile) === ownerName
    ) {
      result = Math.min(result ?? Infinity, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return result;
}

function callPosition(
  body: ts.Node,
  calleeName: string,
  sourceFile: ts.SourceFile,
): number | undefined {
  let result: number | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === calleeName
    ) {
      result = Math.min(result ?? Infinity, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return result;
}

function methodDispatchGateViolation(
  sourceFile: ts.SourceFile,
  methodName: string,
  boundaryOwner: string,
  boundaryName: string,
): ChatSendGateViolation | undefined {
  const method = classMethod(sourceFile, "AgentKitClient", methodName);
  const body = method?.body;
  if (!method || !body) {
    return {
      file: sourceFile.fileName,
      line: 1,
      startLine: 1,
      endLine: 1,
      reason: `AgentKitClient.${methodName} must gate dispatch through assertAiSetupReady`,
    };
  }
  const gatePosition = awaitedMemberCallPosition(
    body,
    "assertAiSetupReady",
    sourceFile,
  );
  const dispatchPosition = memberAccessPosition(
    body,
    boundaryOwner,
    boundaryName,
    sourceFile,
  );
  if (
    gatePosition !== undefined &&
    dispatchPosition !== undefined &&
    gatePosition < dispatchPosition
  ) {
    return undefined;
  }
  const range = lineRange(method, sourceFile);
  return {
    file: normalizePath(sourceFile.fileName),
    line: range.start,
    startLine: range.start,
    endLine: range.end,
    reason: `AgentKitClient.${methodName} must await assertAiSetupReady before ${boundaryName}`,
  };
}

function admittedContinuationViolation(
  sourceFile: ts.SourceFile,
): ChatSendGateViolation | undefined {
  const method = classMethod(sourceFile, "AgentKitClient", "continueRun");
  const parameters = method?.parameters.map((parameter) =>
    ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
  );
  const body = method?.body;
  const continuationAliases = new Set<string>();
  let resumesRecordedRun = false;
  let continuationDispatchPosition: number | undefined;
  if (body) {
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isPropertyAccessExpression(node.initializer) &&
        node.initializer.name.text === "continueRun" &&
        node.initializer.expression.getText(sourceFile) === "this.transport"
      ) {
        continuationAliases.add(node.name.text);
      }
      if (
        ts.isCallExpression(node) &&
        ((ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "continueRun" &&
          node.expression.expression.getText(sourceFile) ===
            "this.transport") ||
          (ts.isIdentifier(node.expression) &&
            continuationAliases.has(node.expression.text)))
      ) {
        continuationDispatchPosition = Math.min(
          continuationDispatchPosition ?? Infinity,
          node.getStart(sourceFile),
        );
        if (
          node.arguments[0] &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          const fields = new Set(
            node.arguments[0].properties.flatMap((property) => {
              if (ts.isShorthandPropertyAssignment(property)) {
                return [property.name.text];
              }
              return ts.isPropertyAssignment(property)
                ? [propertyName(property.name)]
                : [];
            }),
          );
          resumesRecordedRun = fields.has("threadId") && fields.has("runId");
        }
      }
      if (!resumesRecordedRun) ts.forEachChild(node, visit);
    };
    visit(body);
  }
  const readinessGatePosition = body
    ? awaitedMemberCallPosition(body, "assertAiSetupReady", sourceFile)
    : undefined;
  if (
    method &&
    parameters?.[0] === "threadId" &&
    parameters[1] === "runId" &&
    resumesRecordedRun &&
    readinessGatePosition !== undefined &&
    continuationDispatchPosition !== undefined &&
    readinessGatePosition < continuationDispatchPosition
  ) {
    return undefined;
  }
  const range = method ? lineRange(method, sourceFile) : undefined;
  return {
    file: normalizePath(sourceFile.fileName),
    line: range?.start ?? 1,
    startLine: range?.start ?? 1,
    endLine: range?.end ?? 1,
    reason:
      "AgentKitClient.continueRun must await assertAiSetupReady before resuming an admitted thread and run id",
  };
}

function agentKitReadyCallbackViolation(
  sourceFile: ts.SourceFile,
): ChatSendGateViolation | undefined {
  const method = classMethod(
    sourceFile,
    "AgentKitClient",
    "assertAiSetupReady",
  );
  const body = method?.body;
  if (!method || !body) {
    return {
      file: normalizePath(sourceFile.fileName),
      line: 1,
      startLine: 1,
      endLine: 1,
      reason:
        "AgentKitClient.assertAiSetupReady must call through to its transport readiness callback",
    };
  }

  let callsCallback = false;
  let silentlyReturnsWhenMissing = false;
  const inspect = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "assertReady" &&
      !node.questionDotToken
    ) {
      callsCallback = true;
    }
    if (ts.isIfStatement(node)) {
      let checksCallback = false;
      const inspectCondition = (conditionNode: ts.Node) => {
        if (
          ts.isIdentifier(conditionNode) &&
          conditionNode.text === "assertReady"
        ) {
          checksCallback = true;
        }
        ts.forEachChild(conditionNode, inspectCondition);
      };
      inspectCondition(node.expression);
      const isExplicitNotApplicableCheck = (condition: ts.Node) => {
        let found = false;
        const find = (candidate: ts.Node) => {
          if (
            ts.isBinaryExpression(candidate) &&
            candidate.operatorToken.kind ===
              ts.SyntaxKind.EqualsEqualsEqualsToken &&
            ts.isPropertyAccessExpression(candidate.left) &&
            candidate.left.name.text === "aiSetupReadiness" &&
            ts.isStringLiteral(candidate.right) &&
            candidate.right.text === "not-applicable"
          ) {
            found = true;
          }
          ts.forEachChild(candidate, find);
        };
        find(condition);
        return found;
      };
      const inspectForBareReturn = (branch: ts.Statement) => {
        if (ts.isReturnStatement(branch)) {
          silentlyReturnsWhenMissing = true;
        }
        ts.forEachChild(branch, (child) => {
          if (ts.isIfStatement(child)) {
            if (!isExplicitNotApplicableCheck(child.expression)) {
              inspectForBareReturn(child.thenStatement);
              if (child.elseStatement) {
                inspectForBareReturn(child.elseStatement);
              }
            }
          } else if (ts.isStatement(child)) {
            inspectForBareReturn(child);
          }
        });
      };
      if (checksCallback) inspectForBareReturn(node.thenStatement);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(body);

  if (callsCallback && !silentlyReturnsWhenMissing) return undefined;
  const range = lineRange(method, sourceFile);
  return {
    file: normalizePath(sourceFile.fileName),
    line: range.start,
    startLine: range.start,
    endLine: range.end,
    reason: callsCallback
      ? "AgentKitClient.assertAiSetupReady may not return successfully when its transport readiness callback is absent"
      : "AgentKitClient.assertAiSetupReady must call through to its transport readiness callback",
  };
}

function hasAwaitedCallBefore(
  body: ts.Node,
  ownerName: string,
  memberName: string,
  sourceFile: ts.SourceFile,
  boundaryPosition: number | undefined,
): boolean {
  if (boundaryPosition === undefined) return false;
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isAwaitExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === memberName &&
      node.expression.expression.expression.getText(sourceFile) === ownerName &&
      node.getStart(sourceFile) < boundaryPosition
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function hasPropertyCall(
  sourceFile: ts.SourceFile,
  propertyNameToFind: string,
  callName: string,
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === propertyNameToFind
    ) {
      const inspect = (child: ts.Node) => {
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === callName
        ) {
          found = true;
        }
        ts.forEachChild(child, inspect);
      };
      inspect(node.initializer);
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function namedFunctionCalls(
  sourceFile: ts.SourceFile,
  functionName: string,
  callName: string,
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    const isNamedFunction =
      (ts.isFunctionDeclaration(node) && node.name?.text === functionName) ||
      (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === functionName &&
        node.initializer !== undefined &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer)));
    if (isNamedFunction) {
      const inspect = (child: ts.Node) => {
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === callName
        ) {
          found = true;
        }
        ts.forEachChild(child, inspect);
      };
      inspect(node);
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function hasShorthandProperty(
  sourceFile: ts.SourceFile,
  propertyNameToFind: string,
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === propertyNameToFind
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function structuralDispatchViolations(
  relativeFile: string,
  sourceFile: ts.SourceFile,
): ChatSendGateViolation[] {
  const violations: ChatSendGateViolation[] = [];
  if (relativeFile === AGENTKIT_CONTROLLER_FILE) {
    for (const [methodName, owner, member] of [
      ["sendMessage", "this", "setThread"],
      ["queueMessage", "this", "invokeRequest"],
    ] as const) {
      const violation = methodDispatchGateViolation(
        sourceFile,
        methodName,
        owner,
        member,
      );
      if (violation) violations.push(violation);
    }
    const continuationViolation = admittedContinuationViolation(sourceFile);
    if (continuationViolation) violations.push(continuationViolation);
    const callbackViolation = agentKitReadyCallbackViolation(sourceFile);
    if (callbackViolation) violations.push(callbackViolation);
  }

  if (relativeFile === CORE_RUNTIME_FILE) {
    let startTurn: ts.Node | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "startTurn" &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer))
      ) {
        startTurn = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const body = startTurn && "body" in startTurn ? startTurn.body : undefined;
    const fetchPosition = body
      ? callPosition(body, "fetchImpl", sourceFile)
      : undefined;
    const awaitedHook = body
      ? hasAwaitedCallBefore(
          body,
          "options",
          "beforeStartTurn",
          sourceFile,
          fetchPosition,
        )
      : false;
    if (!body || !awaitedHook) {
      violations.push({
        file: relativeFile,
        line: startTurn
          ? lineAt(sourceFile, startTurn.getStart(sourceFile))
          : 1,
        startLine: startTurn
          ? lineAt(sourceFile, startTurn.getStart(sourceFile))
          : 1,
        endLine: startTurn ? lineAt(sourceFile, startTurn.end - 1) : 1,
        reason:
          "HTTP runtime startTurn must await beforeStartTurn before its fetch dispatch",
      });
    }
    if (
      !hasPropertyCall(
        sourceFile,
        "beforeStartTurn",
        "requireAgentEngineConfiguredForDispatch",
      )
    ) {
      violations.push({
        file: relativeFile,
        line: 1,
        startLine: 1,
        endLine: 1,
        reason:
          "Agent-Native runtime must gate user-initiated starts through beforeStartTurn",
      });
    }
  }

  if (relativeFile === CORE_AGENTKIT_TRANSPORT_FILE) {
    if (
      !hasPropertyCall(
        sourceFile,
        "assertAiSetupReady",
        "requireAgentEngineConfiguredForDispatch",
      ) &&
      !(
        hasShorthandProperty(sourceFile, "assertAiSetupReady") &&
        namedFunctionCalls(
          sourceFile,
          "assertAiSetupReady",
          "requireAgentEngineConfiguredForDispatch",
        )
      )
    ) {
      violations.push({
        file: relativeFile,
        line: 1,
        startLine: 1,
        endLine: 1,
        reason:
          "Agent-Native controller transport must wire assertAiSetupReady to the shared readiness gate",
      });
    }
  }

  return violations;
}

function isReadinessBypassFalseCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isIdentifier(node.expression)) return false;
  const name = node.expression.text;
  return (
    (name === "useAgentEngineConfigured" ||
      name === "fetchAgentEngineConfiguredState") &&
    isFalse(node.arguments[0])
  );
}

function isFalseBypassProperty(node: ts.Node): boolean {
  if (ts.isJsxAttribute(node)) {
    const name = node.name.getText();
    const expression =
      node.initializer && ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : undefined;
    return (
      (name === "requireAgentEngine" || /ChecksEnabled$/u.test(name)) &&
      isFalse(expression)
    );
  }
  if (ts.isPropertyAssignment(node)) {
    const name = propertyName(node.name);
    return (
      (name === "requireAgentEngine" ||
        (name !== null && /ChecksEnabled$/u.test(name))) &&
      isFalse(node.initializer)
    );
  }
  return false;
}

export function findChatSendGateViolations(
  file: string,
  source: string,
): ChatSendGateViolation[] {
  const relativeFile = normalizePath(file);
  const sourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativeFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const stringConstants = collectStringConstants(sourceFile);
  const initConstants = collectInitConstants(sourceFile);
  const fetchNames = fetchAliases(sourceFile);
  const violations: ChatSendGateViolation[] = [];
  const add = (node: ts.Node, reason: string) => {
    const range = lineRange(node, sourceFile);
    violations.push({
      file: relativeFile,
      line: lineAt(sourceFile, node.getStart(sourceFile)),
      startLine: range.start,
      endLine: range.end,
      reason,
    });
  };

  const inspect = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /\/_agent-native\/agent-engine\/status(?:[?#]|$)/u.test(node.text) &&
      !STATUS_ROUTE_FILES.has(relativeFile)
    ) {
      add(
        node,
        "agent-engine readiness status reads must use the shared readiness/status helper",
      );
    }

    if (
      ts.isCallExpression(node) &&
      routeArgument(node, sourceFile, stringConstants)
    ) {
      const method = requestCallMethod(node, initConstants, fetchNames);
      const isRequestCall = isFetchLike(node.expression, fetchNames);
      if (
        isRequestCall ||
        (method !== "GET" && method !== "HEAD" && method !== "OPTIONS")
      ) {
        if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
          ts.forEachChild(node, inspect);
          return;
        }
        const isApprovedBoundary =
          APPROVED_DISPATCH_FILES.has(relativeFile) ||
          relativeFile === BACKGROUND_SESSION_FILE;
        const isGatedBoundary =
          isApprovedBoundary && hasDispatchReadinessBefore(node, sourceFile);
        if (!isGatedBoundary) {
          add(
            node,
            relativeFile === BACKGROUND_SESSION_FILE
              ? "background session POST must pass readiness before sending"
              : isApprovedBoundary
                ? "shared dispatch boundary prompt POST must pass readiness before sending"
                : "prompt POST must use an approved shared dispatch boundary instead of raw fetch",
          );
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetchAgentEngineStatus" &&
      !STATUS_ROUTE_FILES.has(relativeFile)
    ) {
      add(
        node,
        "agent-engine status reads must use the shared status helper or readiness hook",
      );
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "ensureAgentEngineReadiness" ||
        node.expression.text === "fetchAgentEngineConfiguredState") &&
      !READINESS_ADAPTERS.has(relativeFile)
    ) {
      add(
        node,
        "readiness probes must stay behind the shared readiness module and hook",
      );
    }

    if (isReadinessBypassFalseCall(node)) {
      add(node, "readiness checks may not be disabled at a dispatch surface");
    }
    if (isFalseBypassProperty(node)) {
      add(node, "provider readiness bypass props may not be set to false");
    }

    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  violations.push(...structuralDispatchViolations(relativeFile, sourceFile));
  return violations.filter(
    (violation) => !hasChatSendGateOptOut(source, violation.startLine),
  );
}

function main(): void {
  const added = requireAddedLines(REPO_ROOT, "guard-chat-send-gate");
  const violations: ChatSendGateViolation[] = [];
  const inspectedFiles = new Set<string>();

  for (const [absolutePath, addedLineNumbers] of added) {
    const relativeFile = normalizePath(path.relative(REPO_ROOT, absolutePath));
    if (
      !SOURCE_ROOT.test(relativeFile) ||
      !SOURCE_FILE.test(relativeFile) ||
      TEST_FILE.test(relativeFile)
    ) {
      continue;
    }

    let source: string;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      console.error(
        `guard-chat-send-gate: could not read ${relativeFile}: ${String(error)}`,
      );
      process.exit(2);
    }
    inspectedFiles.add(relativeFile);
    const addedViolations = findChatSendGateViolations(
      relativeFile,
      source,
    ).filter((violation) => {
      for (
        let line = violation.startLine;
        line <= violation.endLine;
        line += 1
      ) {
        if (addedLineNumbers.has(line)) return true;
      }
      return false;
    });
    violations.push(...addedViolations);
  }

  // These checks inspect the whole shared chokepoint whenever guards run, so
  // deleting a gate is caught even though deleted lines are absent from diff.
  for (const relativeFile of CHAT_SEND_GATE_WHOLE_FILE_BOUNDARIES) {
    const absolutePath = path.join(REPO_ROOT, relativeFile);
    let source: string;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      console.error(
        `guard-chat-send-gate: could not read architectural boundary ${relativeFile}: ${String(error)}`,
      );
      process.exit(2);
    }
    inspectedFiles.add(relativeFile);
    const structural =
      relativeFile === BACKGROUND_SESSION_FILE
        ? findChatSendGateViolations(relativeFile, source)
        : structuralDispatchViolations(
            relativeFile,
            ts.createSourceFile(
              relativeFile,
              source,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS,
            ),
          );
    violations.push(
      ...structural.filter(
        (violation) => !hasChatSendGateOptOut(source, violation.startLine),
      ),
    );
  }

  const uniqueViolations = violations.filter(
    (violation, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.file === violation.file &&
          candidate.line === violation.line &&
          candidate.reason === violation.reason,
      ) === index,
  );

  if (uniqueViolations.length === 0) {
    console.log(
      `guard-chat-send-gate: OK (${inspectedFiles.size} files inspected)`,
    );
    return;
  }

  console.error(
    `\nguard-chat-send-gate: ${uniqueViolations.length} prompt dispatch bypass(es) found (${inspectedFiles.size} files inspected).\n`,
  );
  console.error(
    "Prompt sends must pass through the shared AgentKit/runtime dispatch gate.\n" +
      "Read-only thread/history/status requests are not prompt dispatches.\n",
  );
  for (const violation of uniqueViolations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.reason}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
