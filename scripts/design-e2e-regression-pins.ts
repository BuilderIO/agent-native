import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export const DESIGN_E2E_REGRESSION_SHARDS = [
  "inspector-1a",
  "inspector-1b",
  "inspector-2",
  "inspector-3a",
  "inspector-3b",
  "inspector-4a",
  "inspector-4b",
  "drag-1a",
  "drag-1b",
  "drag-2a",
  "drag-2b",
  "position-1a",
  "position-1b",
  "position-2a",
  "position-2b",
  "position-3",
] as const;

export type DesignE2ERegressionShard =
  (typeof DESIGN_E2E_REGRESSION_SHARDS)[number];

export type DesignE2ERegressionPin = {
  readonly shard: DesignE2ERegressionShard | string;
  readonly file: string;
  readonly title: string;
};

export type DesignE2ETestRegistration = {
  readonly title: string;
  readonly dynamic: boolean;
  readonly modifier?: string;
  readonly line: number;
  readonly suppressionKind:
    | "direct"
    | "suite"
    | "runtime"
    | "file"
    | "focus"
    | null;
  readonly suppressionReason?: string;
};

export const DESIGN_E2E_REGRESSION_PINS = [
  {
    shard: "inspector-1a",
    file: "builder-shell-no-network.spec.ts",
    title: "the Builder shell canvas makes no agent-native requests",
  },
  {
    shard: "inspector-1a",
    file: "canvas-invariants.spec.ts",
    title:
      "a stretched child of an auto-layout column shows its laid-out width and height",
  },
  {
    shard: "inspector-1a",
    file: "canvas-invariants.spec.ts",
    title:
      "Delete on a canvas-selected layer removes exactly that node from the saved document",
  },
  {
    shard: "inspector-1b",
    file: "inspector-styles.spec.ts",
    title: "selection hide and Appearance visibility stay in sync with opacity",
  },
  {
    shard: "inspector-1b",
    file: "inspector-styles.spec.ts",
    title:
      "text gradient apply and removal survive reselection; box gradient editor persists",
  },
  {
    shard: "inspector-2",
    file: "canvas-invariants.spec.ts",
    title:
      "an in-flow element inside nested auto layout with no frame ancestor shows its screen position, not 0,0",
  },
  {
    shard: "inspector-2",
    file: "canvas-invariants.spec.ts",
    title:
      "typing X then Y moves Plain Box to exactly that position and changes nothing else",
  },
  {
    shard: "inspector-2",
    file: "inspector-styles.spec.ts",
    title: "typography edits update size and spacing inputs",
  },
  {
    shard: "inspector-2",
    file: "inspector-styles.spec.ts",
    title:
      "numeric scrub handles use terse tooltips and drag from compact labels",
  },
  {
    shard: "inspector-2",
    file: "inspector-styles.spec.ts",
    title:
      "appearance controls use droplet blend menu and inline independent corners",
  },
  {
    shard: "inspector-3a",
    file: "inspector-styles.spec.ts",
    title: "resizing a selected element emits a visual-style-change payload",
  },
  {
    shard: "inspector-3a",
    file: "text-tool-board-creation.spec.ts",
    title:
      "single-screen control: text tool click then immediate typing still works",
  },
  {
    shard: "inspector-3b",
    file: "inspector-styles.spec.ts",
    title:
      "pointercancel restores a scrubbed value without adding a history step",
  },
  {
    shard: "inspector-3b",
    file: "interaction-selection.spec.ts",
    title: "double-click after selecting Card drills into the clicked child",
  },
  {
    shard: "inspector-4a",
    file: "inspector-styles.spec.ts",
    title:
      "numeric input applies arithmetic expressions and starts an Option scrub drag",
  },
  {
    shard: "inspector-4a",
    file: "text-edit-roundtrip.spec.ts",
    title:
      "inline text edit commits, undo and redo restore exact content, and reload keeps it",
  },
  {
    shard: "inspector-4b",
    file: "inspector-styles.spec.ts",
    title: "export rows add, remove, and reset when selection changes",
  },
  {
    shard: "inspector-4b",
    file: "inspector-styles.spec.ts",
    title: "style layer row actions stay visible and toggle visibility state",
  },
  {
    shard: "inspector-4b",
    file: "text-range-visibility.spec.ts",
    title: "Line Height Enter returns a real Text-tool range to the editor",
  },
  {
    shard: "drag-1a",
    file: "corner-radius-handle-drag.spec.ts",
    title:
      "canvas corner-radius handle follows the drag and persists the radius",
  },
  {
    shard: "drag-1a",
    file: "overview-wheel-zoom.spec.ts",
    title: "the zoom percentage input updates the overview canvas scale",
  },
  {
    shard: "drag-1a",
    file: "interaction-selection.spec.ts",
    title: "cmd+click deep-selects Kid B directly with no prior selection",
  },
  {
    shard: "drag-1b",
    file: "drag-and-drop.drag-feedback.spec.ts",
    title: "snap guides appear when an edge aligns with a sibling",
  },
  {
    shard: "drag-1b",
    file: "drag-and-drop.moving-by-drag.spec.ts",
    title: "dropping over a sibling keeps the moved position after reload",
  },
  {
    shard: "drag-1b",
    file: "interaction-selection.spec.ts",
    title:
      "shift+click adds an unselected object, then removes it on a second shift+click",
  },
  {
    shard: "drag-2a",
    file: "drag-and-drop.moving-by-drag.spec.ts",
    title: "Alt+drag leaves the original and creates a copy",
  },
  {
    shard: "drag-2a",
    file: "interaction-alt-drag-duplicate.spec.ts",
    title:
      "copies a root auto-layout Frame as a selected board-root layer and preserves its original",
  },
  {
    shard: "drag-2a",
    file: "interaction-selection.spec.ts",
    title:
      "board regression: an overlapping Frame drop into another board Frame persists after reload",
  },
  {
    shard: "drag-2a",
    file: "interaction-selection.spec.ts",
    title: "a marquee over Card selects Card only, not its children",
  },
  {
    shard: "drag-2b",
    file: "interaction-selection.spec.ts",
    title:
      "board regression: overlapping board Frames keep the pointer drop without cancel or revert",
  },
  {
    shard: "drag-2b",
    file: "interaction-selection.spec.ts",
    title:
      "selected nested frame drag from its grandchild tracks the pointer and persists",
  },
  {
    shard: "drag-2b",
    file: "interaction-selection.spec.ts",
    title: "clicking a child inside Card selects Card, not Kid A",
  },
  {
    shard: "position-1a",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "clipboard SVG File paste in the parent editor stays editable after reload",
  },
  {
    shard: "position-1a",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "clipboard SVG File paste relayed from a Screen iframe stays in that Screen",
  },
  {
    shard: "position-1a",
    file: "position-alignment.spec.ts",
    title: "Auto Layout matrix centers both axes and persists after reload",
  },
  {
    shard: "position-1b",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "Figma frame paste uses the live Design scene and updates the selected frame inspector",
  },
  {
    shard: "position-1b",
    file: "position-alignment.spec.ts",
    title:
      "canvas and Layers selection show parent-relative position after iframe scroll",
  },
  {
    shard: "position-1b",
    file: "position-alignment.spec.ts",
    title:
      "fixed Position stays viewport-relative after iframe scroll and reload",
  },
  {
    shard: "position-2a",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "Figma paste plans can insert a frame into the Design board and persist it",
  },
  {
    shard: "position-2a",
    file: "position-alignment.spec.ts",
    title: "Left and Right alignment controls move to their named edges",
  },
  {
    shard: "position-2a",
    file: "position-alignment.spec.ts",
    title:
      "Position stays Frame-relative through Groups and resets at nested Frames",
  },
  {
    shard: "position-2b",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "clipboard SVG File paste from the board iframe targets the selected Screen",
  },
  {
    shard: "position-2b",
    file: "position-alignment.spec.ts",
    title:
      "Position edits use the CSS containing block through static wrappers and borders",
  },
  {
    shard: "position-2b",
    file: "position-alignment.spec.ts",
    title: "Position stays Frame-relative through a positioned plain wrapper",
  },
  {
    shard: "position-2b",
    file: "canvas-tools.spec.ts",
    title:
      "new empty text is one atomic undo step and cancel leaves the frame intact",
  },
  {
    shard: "position-3",
    file: "position-alignment.spec.ts",
    title: "Top and Bottom alignment controls move to their named edges",
  },
  {
    shard: "position-3",
    file: "position-alignment.spec.ts",
    title:
      "unframed absolute positions use the initial containing block through static wrappers",
  },
  {
    shard: "position-3",
    file: "position-alignment.spec.ts",
    title:
      "Position edits invert own and static-containing-block transforms and persist",
  },
  {
    shard: "position-3",
    file: "position-alignment.spec.ts",
    title: "Align uses a Group's bounds while Position stays Frame-relative",
  },
  {
    shard: "inspector-1a",
    file: "ai-source-continuity.spec.ts",
    title:
      "Layers-first editing preserves identity in the AI-generated Orbit source",
  },
  {
    shard: "inspector-1b",
    file: "ai-source-continuity.spec.ts",
    title:
      "duplicate authored IDs are repaired before Layers-first edits and persist after reload",
  },
  {
    shard: "inspector-3a",
    file: "ai-source-continuity.spec.ts",
    title:
      "edit-design rejects malformed AI CSS without changing the styled canvas",
  },
  {
    shard: "drag-1a",
    file: "ai-source-continuity.spec.ts",
    title:
      "dropping a layer from AI-generated source into a panel keeps its node ID and its drop position",
  },
  {
    shard: "drag-1b",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "round-trips a styled nested layer across independent designs, route remounts, and browser tabs as one undo step",
  },
  {
    shard: "drag-2b",
    file: "editor-keyboard-layers.spec.ts",
    title: "keeps two responsive pastes distinct across settled undo and redo",
  },
  {
    shard: "position-1a",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "pastes a nested selected layer on the same screen and another screen with fresh ids after reload",
  },
  {
    shard: "position-1b",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "pastes a multi-selection across screens with each layer and child id regenerated",
  },
  {
    shard: "position-2a",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "duplicates, deletes, cuts, undoes, and redoes selected layers from the keyboard",
  },
  {
    shard: "inspector-3b",
    file: "editor.spec.ts",
    title:
      "deeply nested layer rows keep a clickable hit target without scrolling the tree sideways",
  },
  {
    shard: "drag-2a",
    file: "interaction-selection.spec.ts",
    title: "cmd+marquee over Card reaches into Kid A and Kid B",
  },
  {
    shard: "inspector-4a",
    file: "text-keyboard-workflow.spec.ts",
    title:
      "Cmd+Enter commits a text edit so Cmd+D duplicates the layer, and each copy keeps its own text and name",
  },
  {
    shard: "inspector-4b",
    file: "interaction-unique-paths.spec.ts",
    title:
      "paste properties copies the source's fill, border, radius and opacity onto the target and keeps the target's position and size",
  },
  {
    shard: "position-2b",
    file: "auto-layout-keyboard.spec.ts",
    title:
      "pasting into a selected frame puts one copy of Alpha inside it at Alpha's size",
  },
  {
    shard: "position-3",
    file: "paste-svg-into-selected-frame.spec.ts",
    title:
      "Cmd+V of SVG markup while a frame is selected appends the SVG as the frame's topmost child, drawn above its siblings, and selects it",
  },
  {
    shard: "inspector-3a",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R drops the replacement where the old layer stood",
  },
  {
    shard: "inspector-4a",
    file: "canvas-chords.spec.ts",
    title:
      "clicking an inline child on the board surface selects it and leaves its text alone",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R on an underlined text layer does not nest a copy inside it",
  },
  {
    shard: "inspector-1b",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "pasted SVG is an editable sized layer and image scale mode writes object-fit",
  },
  {
    shard: "drag-1a",
    file: "drag-and-drop.drop-containers-modifier-collisions-marquee.spec.ts",
    title: "dragging from empty canvas marquee-selects the elements it covers",
  },
  {
    shard: "drag-2b",
    file: "performance-bridge-baseline.spec.ts",
    title:
      "a Cmd-marquee across a large screen and a small one scans each crossed screen once and commits the selection once",
  },
  {
    shard: "inspector-4b",
    file: "structure-selection.spec.ts",
    title:
      "Cmd+Shift+G ungroups: the children return to the page at their original positions and stay selected together",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R replaces a flow text root at its measured origin",
  },
  {
    shard: "inspector-1a",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R uses rendered flow offsets for relative text",
  },
  {
    shard: "inspector-3a",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R maps flow placement through rotated and skewed ancestors",
  },
  {
    shard: "inspector-4a",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R places a zero-size flow text root at its measured origin",
  },
  {
    shard: "inspector-1b",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R places a stylesheet-sized transformed copy at the target bounds",
  },
  {
    shard: "drag-1b",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R replaces wrapped inline text at its measured origin",
  },
  {
    shard: "position-1a",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R preserves a top-only transform origin on the copied layer",
  },
  {
    shard: "position-2a",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R places a margin-offset copy at the target bounds",
  },
  {
    shard: "position-1b",
    file: "select-layer-context-menu.spec.ts",
    title:
      "Select layer on a non-active overview screen preserves exact screen and layer identity",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard paste preserves non-pixel margins at exact visual coordinates",
  },
  {
    shard: "position-3",
    file: "canvas-chords.spec.ts",
    title: "Keyboard paste and replacement preserve board-layer geometry",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard paste and replacement measure the active breakpoint preview",
  },
  {
    shard: "inspector-3a",
    file: "canvas-chords.spec.ts",
    title: "Keyboard repeat paste preserves mixed positioned and flow roots",
  },
] as const satisfies readonly DesignE2ERegressionPin[];

export function parseDesignE2ERegressionPins(
  source: string,
): DesignE2ERegressionPin[] {
  const sourceFile = ts.createSourceFile(
    "design-e2e-regression-pins.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error("base pin manifest has TypeScript syntax errors");
  }

  const declarations = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "DESIGN_E2E_REGRESSION_PINS",
    );
  if (declarations.length !== 1) {
    throw new Error(
      `base pin manifest must declare DESIGN_E2E_REGRESSION_PINS exactly once; found ${declarations.length}`,
    );
  }

  let initializer = declarations[0]!.initializer;
  while (
    initializer &&
    (ts.isAsExpression(initializer) ||
      ts.isSatisfiesExpression(initializer) ||
      ts.isParenthesizedExpression(initializer))
  ) {
    initializer = initializer.expression;
  }
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error(
      "base pin manifest must initialize pins with an array literal",
    );
  }

  const pins: DesignE2ERegressionPin[] = [];
  for (const [index, element] of initializer.elements.entries()) {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(
        `base pin manifest entry ${index + 1} must be an object literal`,
      );
    }
    const fields = new Map<string, string>();
    for (const property of element.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        ts.isComputedPropertyName(property.name) ||
        (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteral(property.name)) ||
        (!ts.isStringLiteral(property.initializer) &&
          !ts.isNoSubstitutionTemplateLiteral(property.initializer))
      ) {
        throw new Error(
          `base pin manifest entry ${index + 1} must contain only literal fields`,
        );
      }
      if (fields.has(property.name.text)) {
        throw new Error(
          `base pin manifest entry ${index + 1} repeats ${property.name.text}`,
        );
      }
      fields.set(property.name.text, property.initializer.text);
    }
    const shard = fields.get("shard");
    const file = fields.get("file");
    const title = fields.get("title");
    if (!shard || !file || !title || fields.size !== 3) {
      throw new Error(
        `base pin manifest entry ${index + 1} must contain only shard, file, and title strings`,
      );
    }
    pins.push({ shard, file, title });
  }
  const identities = new Set<string>();
  for (const pin of pins) {
    const identity = pinIdentity(pin);
    if (identities.has(identity)) {
      throw new Error(
        `base pin manifest contains duplicate identity: ${pin.file} / ${pin.title}`,
      );
    }
    identities.add(identity);
  }
  return pins;
}

const TEST_MODIFIERS = new Set(["fail", "fixme", "only", "skip"]);

class DisabledRegressionPinError extends Error {}
class PinInspectionUnavailableError extends Error {}

function rejectDisabledPin(title: string, reason: string): never {
  throw new DisabledRegressionPinError(
    `Design E2E pin title ${JSON.stringify(title)} must run without test modifiers or suite/file suppression: ${reason}`,
  );
}

type MutableRegistration = {
  file: string;
  title: string;
  dynamic: boolean;
  modifier?: string;
  line: number;
  suppressionKind: DesignE2ETestRegistration["suppressionKind"];
  suppressionReason?: string;
  suiteRuntimeScopes: string[][];
};

type RegistrationWalkContext = {
  suiteSuppressions: string[];
  currentTest?: MutableRegistration;
  testInfoNames: Set<string>;
  suiteRuntimeScopes: string[][];
};

function propertyPath(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...propertyPath(expression.expression), expression.name.text];
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return [
      ...propertyPath(expression.expression),
      expression.argumentExpression.text,
    ];
  }
  return [];
}

function testImports(sourceFile: ts.SourceFile) {
  const bindings = new Set(["test"]);
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const namedBindings = statement.importClause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === "test") {
          bindings.add(element.name.text);
        }
      }
    } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
    } else if (
      statement.importClause.name &&
      /(?:@playwright\/test|\/rails)$/.test(statement.moduleSpecifier.text)
    ) {
      bindings.add(statement.importClause.name.text);
    }
  }
  return { bindings, namespaces };
}

function normalizedTestPath(
  expression: ts.Expression,
  bindings: Set<string>,
  namespaces: Set<string>,
) {
  const segments = propertyPath(expression);
  if (bindings.has(segments[0] ?? "")) return segments;
  if (namespaces.has(segments[0] ?? "") && segments[1] === "test") {
    return segments.slice(1);
  }
  return [];
}

function testCallKind(
  call: ts.CallExpression,
  bindings: Set<string>,
  namespaces: Set<string>,
  testInfoNames: Set<string>,
): { kind: "test" | "describe" | "runtime"; modifier?: string } | undefined {
  const segments = propertyPath(call.expression);
  const testPath = normalizedTestPath(call.expression, bindings, namespaces);
  if (testPath.length === 1) return { kind: "test" };
  if (testPath.length === 2 && TEST_MODIFIERS.has(testPath[1]!)) {
    return { kind: "test", modifier: testPath[1] };
  }
  if (testPath.length === 2 && testPath[1] === "describe") {
    return { kind: "describe" };
  }
  if (
    testPath.length === 3 &&
    testPath[1] === "describe" &&
    TEST_MODIFIERS.has(testPath[2]!)
  ) {
    return { kind: "describe", modifier: testPath[2] };
  }

  const expression = call.expression;
  if (
    ts.isPropertyAccessExpression(expression) &&
    TEST_MODIFIERS.has(expression.name.text) &&
    ts.isCallExpression(expression.expression)
  ) {
    const receiverPath = normalizedTestPath(
      expression.expression.expression,
      bindings,
      namespaces,
    );
    if (receiverPath.length === 2 && receiverPath[1] === "info") {
      return { kind: "runtime", modifier: expression.name.text };
    }
  }
  if (
    segments.length === 2 &&
    testInfoNames.has(segments[0]!) &&
    TEST_MODIFIERS.has(segments[1]!)
  ) {
    return { kind: "runtime", modifier: segments[1] };
  }
  return undefined;
}

function isCallback(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function modifierSuppression(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  modifier: string,
): string | undefined {
  if (modifier === "only") return "focus";
  if (["fixme", "skip", "fail"].includes(modifier)) {
    const first = call.arguments[0];
    if (first?.kind === ts.SyntaxKind.FalseKeyword) return undefined;
    const line =
      sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line +
      1;
    if (!first || first.kind === ts.SyntaxKind.TrueKeyword) {
      return `test.${modifier} suppresses this test at line ${line}`;
    }
    return `Unable to inspect conditional test.${modifier} at line ${line}`;
  }
  return undefined;
}

function parseTestTitle(
  argument: ts.Expression,
  sourceFile: ts.SourceFile,
): { title: string; dynamic: boolean } {
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return { title: argument.text, dynamic: false };
  }
  const source = argument.getText(sourceFile);
  return {
    title: ts.isTemplateExpression(argument)
      ? `template:${source}`
      : `expression:${source}`,
    dynamic: true,
  };
}

export function findDesignE2ETestRegistrations(
  source: string,
  file = "",
): DesignE2ETestRegistration[] {
  const sourceFile = ts.createSourceFile(
    file || "design.spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0]!;
    const line =
      sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    throw new Error(
      `${file || "Design E2E source"}:${line}: TypeScript syntax error; test identities could not be inspected`,
    );
  }

  const { bindings, namespaces } = testImports(sourceFile);
  const registrations: MutableRegistration[] = [];
  const fileSuppressions: string[] = [];
  let hasFocus = false;
  const visit = (node: ts.Node, context: RegistrationWalkContext) => {
    if (ts.isCallExpression(node)) {
      const classification = testCallKind(
        node,
        bindings,
        namespaces,
        context.testInfoNames,
      );
      if (classification?.kind === "describe") {
        const suiteSuppressions = [...context.suiteSuppressions];
        if (classification.modifier) {
          if (classification.modifier !== "only") {
            suiteSuppressions.push(classification.modifier);
          }
          if (classification.modifier === "only") hasFocus = true;
        }
        for (const argument of node.arguments) {
          visit(
            argument,
            isCallback(argument)
              ? {
                  ...context,
                  suiteSuppressions,
                  suiteRuntimeScopes: [...context.suiteRuntimeScopes, []],
                }
              : context,
          );
        }
        return;
      }

      if (classification?.kind === "test") {
        const callback = node.arguments.find(isCallback);
        if (!context.currentTest && callback) {
          const titleArgument = node.arguments[0];
          if (!titleArgument) {
            throw new Error(
              `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}: test registration has no title`,
            );
          }
          const identity = parseTestTitle(titleArgument, sourceFile);
          const directReason = classification.modifier
            ? modifierSuppression(node, sourceFile, classification.modifier)
            : undefined;
          const suiteModifier = context.suiteSuppressions.find(
            (modifier) => modifier !== "only",
          );
          const suiteReason = suiteModifier
            ? `enclosing test.describe.${suiteModifier} can suppress this test`
            : undefined;
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          const item: MutableRegistration = {
            file,
            ...identity,
            line,
            ...(classification.modifier === undefined
              ? {}
              : { modifier: classification.modifier }),
            suppressionKind: directReason
              ? "direct"
              : suiteReason
                ? "suite"
                : null,
            ...((directReason ?? suiteReason)
              ? { suppressionReason: directReason ?? suiteReason }
              : {}),
            suiteRuntimeScopes: context.suiteRuntimeScopes,
          };
          if (classification.modifier === "only") hasFocus = true;
          registrations.push(item);

          const testInfoNames = new Set(context.testInfoNames);
          const testInfoParameter = callback.parameters[1]?.name;
          if (testInfoParameter && ts.isIdentifier(testInfoParameter)) {
            testInfoNames.add(testInfoParameter.text);
          }
          for (const argument of node.arguments) {
            visit(
              argument,
              isCallback(argument)
                ? { ...context, currentTest: item, testInfoNames }
                : context,
            );
          }
          return;
        }

        if (classification.modifier) {
          const reason = modifierSuppression(
            node,
            sourceFile,
            classification.modifier,
          );
          if (reason) {
            if (context.currentTest) {
              if (!context.currentTest.suppressionKind) {
                context.currentTest.suppressionKind = "runtime";
                context.currentTest.suppressionReason = reason;
              }
            } else {
              const suiteScope = context.suiteRuntimeScopes.at(-1);
              if (suiteScope) suiteScope.push(reason);
              else fileSuppressions.push(reason);
            }
          }
        }
      } else if (classification?.kind === "runtime") {
        const reason = modifierSuppression(
          node,
          sourceFile,
          classification.modifier!,
        );
        if (reason) {
          if (context.currentTest) {
            if (!context.currentTest.suppressionKind) {
              context.currentTest.suppressionKind = "runtime";
              context.currentTest.suppressionReason = reason;
            }
          } else {
            const suiteScope = context.suiteRuntimeScopes.at(-1);
            if (suiteScope) suiteScope.push(reason);
            else fileSuppressions.push(reason);
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, context));
  };
  visit(sourceFile, {
    suiteSuppressions: [],
    testInfoNames: new Set(["testInfo"]),
    suiteRuntimeScopes: [],
  });

  for (const item of registrations) {
    const runtimeSuiteSuppression = item.suiteRuntimeScopes.flat().at(0);
    if (runtimeSuiteSuppression && !item.suppressionKind) {
      item.suppressionKind = "suite";
      item.suppressionReason = runtimeSuiteSuppression;
    }
    if (fileSuppressions.length > 0 && !item.suppressionKind) {
      item.suppressionKind = "file";
      item.suppressionReason = fileSuppressions[0];
    }
    if (hasFocus && !item.suppressionKind) {
      item.suppressionKind = "focus";
      item.suppressionReason =
        "a test.only declaration can focus this file away";
    }
  }
  return registrations.map((item) => ({
    file: item.file,
    title: item.title,
    dynamic: item.dynamic,
    ...(item.modifier === undefined ? {} : { modifier: item.modifier }),
    line: item.line,
    suppressionKind: item.suppressionKind,
    ...(item.suppressionReason === undefined
      ? {}
      : { suppressionReason: item.suppressionReason }),
  }));
}

export function findDesignE2ETestLine(source: string, title: string): number {
  const matches = findDesignE2ETestRegistrations(source).filter(
    (registration) => registration.title === title && !registration.dynamic,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Design E2E pin title ${JSON.stringify(title)} must match exactly one test title; found ${matches.length}`,
    );
  }
  const match = matches[0]!;
  if (match.modifier !== undefined) {
    rejectDisabledPin(title, "the pinned test declaration has a modifier");
  }
  if (match.suppressionKind) {
    if (match.suppressionReason?.startsWith("Unable to inspect conditional")) {
      throw new PinInspectionUnavailableError(match.suppressionReason);
    }
    rejectDisabledPin(title, match.suppressionReason ?? "test is suppressed");
  }
  return match.line;
}

export function resolveDesignE2ERegressionPin(
  pin: DesignE2ERegressionPin,
  options: { readSource?: (path: string) => string } = {},
): string {
  const relativePath = `e2e/${pin.file}`;
  const readSource =
    options.readSource ??
    ((path: string) =>
      readFileSync(
        new URL(`../templates/design/${path}`, import.meta.url),
        "utf8",
      ));
  const source = readSource(relativePath);
  const line = findDesignE2ETestLine(source, pin.title);
  return `${relativePath}:${line}`;
}

export type DesignE2ERegressionPinException = {
  readonly action: "remove" | "rename";
  readonly from: { readonly file: string; readonly title: string };
  readonly to?: { readonly file: string; readonly title: string };
  readonly reason: string;
  readonly evidence: string;
};

function pinIdentity(pin: { readonly file: string; readonly title: string }) {
  return JSON.stringify([pin.file, pin.title]);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function findDesignE2ERegressionPinCoverageViolations(
  basePins: readonly DesignE2ERegressionPin[],
  headPins: readonly DesignE2ERegressionPin[],
  exceptions: readonly DesignE2ERegressionPinException[] = [],
  baseExceptions: readonly DesignE2ERegressionPinException[] = [],
): string[] {
  const violations: string[] = [];
  const baseByIdentity = new Map(
    basePins.map((pin) => [pinIdentity(pin), pin] as const),
  );
  const headByIdentity = new Map<string, DesignE2ERegressionPin>();
  for (const pin of headPins) {
    const identity = pinIdentity(pin);
    if (headByIdentity.has(identity)) {
      violations.push(
        `duplicate head pin identity: ${pin.file} / ${pin.title}`,
      );
    }
    headByIdentity.set(identity, pin);
  }

  const historicalCounts = new Map<string, number>();
  for (const exception of baseExceptions) {
    const id = stableJson(exception);
    historicalCounts.set(id, (historicalCounts.get(id) ?? 0) + 1);
  }
  const historicalIndexes = new Set<number>();
  const newRenameTargets = new Map<string, string>();
  for (const [index, exception] of exceptions.entries()) {
    const id = stableJson(exception);
    const remaining = historicalCounts.get(id) ?? 0;
    if (remaining > 0) {
      historicalIndexes.add(index);
      historicalCounts.set(id, remaining - 1);
    }
  }

  const used = new Set<number>();
  for (const [identity, pin] of baseByIdentity) {
    if (headByIdentity.has(identity)) continue;
    const renameIndex = exceptions.findIndex(
      (exception, index) =>
        !historicalIndexes.has(index) &&
        exception.action === "rename" &&
        pinIdentity(exception.from) === identity &&
        exception.to !== undefined &&
        headByIdentity.has(pinIdentity(exception.to)),
    );
    if (renameIndex >= 0) {
      used.add(renameIndex);
      continue;
    }
    const removalIndex = exceptions.findIndex(
      (exception, index) =>
        !historicalIndexes.has(index) &&
        exception.action === "remove" &&
        pinIdentity(exception.from) === identity,
    );
    if (removalIndex >= 0) {
      used.add(removalIndex);
      continue;
    }
    violations.push(
      `protected Design E2E pin was removed without an explicit exception: ${pin.file} / ${pin.title}`,
    );
  }

  for (const [index, exception] of exceptions.entries()) {
    if (
      !["remove", "rename"].includes(exception.action) ||
      typeof exception.reason !== "string" ||
      typeof exception.evidence !== "string" ||
      !exception.from ||
      typeof exception.from.file !== "string" ||
      !exception.from.file.trim() ||
      typeof exception.from.title !== "string" ||
      !exception.from.title.trim() ||
      (exception.action === "rename" &&
        (!exception.to ||
          typeof exception.to.file !== "string" ||
          !exception.to.file.trim() ||
          typeof exception.to.title !== "string" ||
          !exception.to.title.trim()))
    ) {
      violations.push("incomplete Design E2E pin exception metadata");
      continue;
    }
    if (!exception.reason.trim() || !exception.evidence.trim()) {
      violations.push(
        `invalid or incomplete Design E2E pin exception for ${exception.from.file} / ${exception.from.title}`,
      );
      continue;
    }
    if (historicalIndexes.has(index)) continue;
    if (exception.action === "rename") {
      const targetIdentity = pinIdentity(exception.to!);
      if (baseByIdentity.has(targetIdentity)) {
        violations.push(
          `Design E2E pin rename target already exists in the base: ${exception.to!.file} / ${exception.to!.title}`,
        );
      }
      const previousSource = newRenameTargets.get(targetIdentity);
      if (previousSource) {
        violations.push(
          `multiple Design E2E pin renames target the same identity: ${exception.to!.file} / ${exception.to!.title}`,
        );
      } else {
        newRenameTargets.set(targetIdentity, pinIdentity(exception.from));
      }
    }
    if (!baseByIdentity.has(pinIdentity(exception.from))) {
      violations.push(
        `invalid or incomplete Design E2E pin exception for ${exception.from.file} / ${exception.from.title}`,
      );
      continue;
    }
    if (
      exception.action === "rename" &&
      (!exception.to ||
        !headByIdentity.has(pinIdentity(exception.to)) ||
        pinIdentity(exception.to) === pinIdentity(exception.from))
    ) {
      violations.push(
        `Design E2E pin rename must point to a different head pin: ${exception.from.file} / ${exception.from.title}`,
      );
      continue;
    }
    if (
      exception.action === "remove" &&
      headByIdentity.has(pinIdentity(exception.from))
    ) {
      violations.push(
        `Design E2E pin removal exception is stale because the pin remains: ${exception.from.file} / ${exception.from.title}`,
      );
      continue;
    }
    if (!used.has(index)) {
      violations.push(
        `unused Design E2E pin exception for ${exception.from.file} / ${exception.from.title}`,
      );
    }
  }

  return violations;
}

function validatePinManifest(): void {
  const shardNames = new Set<string>(DESIGN_E2E_REGRESSION_SHARDS);
  if (shardNames.size !== DESIGN_E2E_REGRESSION_SHARDS.length) {
    throw new Error("Design regression shard names must be unique");
  }

  const assignedPins = new Set<string>();
  for (const pin of DESIGN_E2E_REGRESSION_PINS) {
    if (!shardNames.has(pin.shard)) {
      throw new Error(
        `Unknown Design regression shard in pin manifest: ${pin.shard}`,
      );
    }
    const key = `${pin.file}\0${pin.title}`;
    if (assignedPins.has(key)) {
      throw new Error(
        `Duplicate Design regression pin: ${pin.file} / ${pin.title}`,
      );
    }
    assignedPins.add(key);
  }

  for (const shard of DESIGN_E2E_REGRESSION_SHARDS) {
    if (!DESIGN_E2E_REGRESSION_PINS.some((pin) => pin.shard === shard)) {
      throw new Error(`Design regression shard has no pins: ${shard}`);
    }
  }
}

export function resolveDesignE2ERegressionPinsForShard(
  shard: string,
  options: { readSource?: (path: string) => string } = {},
): string[] {
  validatePinManifest();
  if (!(DESIGN_E2E_REGRESSION_SHARDS as readonly string[]).includes(shard)) {
    throw new Error(`Unknown Design regression shard: ${shard}`);
  }

  const pins = DESIGN_E2E_REGRESSION_PINS.filter((pin) => pin.shard === shard);
  if (pins.length === 0) {
    throw new Error(`Design regression shard has no pins: ${shard}`);
  }
  return pins.map((pin) => resolveDesignE2ERegressionPin(pin, options));
}

function runCli(): void {
  const shard = process.argv[2];
  if (!shard || process.argv.length !== 3) {
    process.stderr.write(
      "Usage: node --experimental-strip-types scripts/design-e2e-regression-pins.ts <shard>\n",
    );
    process.exitCode = 2;
    return;
  }

  try {
    const selectors = resolveDesignE2ERegressionPinsForShard(shard);
    process.stdout.write(
      `${selectors.map((selector) => `${selector}\0`).join("")}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::error::Unable to resolve Design regression pins: ${message}\n`,
    );
    process.exitCode = error instanceof DisabledRegressionPinError ? 1 : 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli();
}
