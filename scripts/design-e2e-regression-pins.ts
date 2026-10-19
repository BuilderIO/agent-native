import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type * as TypeScript from "typescript";

const require = createRequire(import.meta.url);
let loadedTypeScript: typeof TypeScript | undefined;

function loadTypeScript(): typeof TypeScript {
  if (!loadedTypeScript) {
    loadedTypeScript = require("typescript") as typeof TypeScript;
  }
  return loadedTypeScript;
}

function parseDiagnostics(
  sourceFile: TypeScript.SourceFile,
): readonly TypeScript.Diagnostic[] {
  return (
    sourceFile as TypeScript.SourceFile & {
      parseDiagnostics: readonly TypeScript.Diagnostic[];
    }
  ).parseDiagnostics;
}

function scriptKindForFile(
  file: string,
  ts: typeof TypeScript,
): TypeScript.ScriptKind {
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  if (file.endsWith(".json")) return ts.ScriptKind.JSON;
  return file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

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
  readonly suppressionFingerprint?: string;
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
    shard: "inspector-1a",
    file: "inspector-styles.spec.ts",
    title: "text fills hide and restore without losing the original color",
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
    shard: "inspector-3a",
    file: "canvas-invariants.spec.ts",
    title:
      "Escape on a rectangle just drawn inside a frame clears the selection without selecting the screen",
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
    shard: "inspector-3b",
    file: "canvas-invariants.spec.ts",
    title:
      "drawing two shapes then undo removes only the frame, and redo restores it selected",
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
    shard: "inspector-4a",
    file: "inspector-styles.spec.ts",
    title: "search selects Lato Medium and keeps custom font names offline",
  },
  {
    shard: "inspector-4a",
    file: "interaction-walkthrough-2.spec.ts",
    title:
      "Shift+A wraps the shift-clicked title and creator in a vertical auto-layout frame without moving them, and saves a gap of 4",
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
    shard: "inspector-4b",
    file: "text-range-visibility.spec.ts",
    title:
      "multi-selected text leaves share inspector styles, edits save to both, and one undo restores both",
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
    shard: "inspector-4a",
    file: "pasted-svg-image-inspector.spec.ts",
    title: "stroke gradient edits stay on the selected nested pasted-SVG shape",
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
    shard: "position-1a",
    file: "interaction-clipboard-duplicate.spec.ts",
    title:
      "cmd+C then cmd+V with nothing else selected pastes into the SAME parent, directly above the source, keeping name and size",
  },
  {
    shard: "position-1b",
    file: "interaction-clipboard-duplicate.spec.ts",
    title: "with a container selected, paste goes inside that container",
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
    shard: "drag-2a",
    file: "interaction-selection.spec.ts",
    title:
      "click-selecting Screen 2 after a nested Screen 1 element replaces the layer selection, so Cmd+A selects all Screens",
  },
  {
    shard: "drag-2b",
    file: "interaction-selection.spec.ts",
    title:
      "marquee-selecting Screen 2 after a nested Screen 1 element replaces the layer selection, so Cmd+A selects all Screens",
  },
  {
    shard: "drag-1a",
    file: "interaction-unique-paths.spec.ts",
    title: "Cmd+A with a child selected selects exactly that child's siblings",
  },
  {
    shard: "drag-1a",
    file: "interaction-unique-paths.spec.ts",
    title: "Cmd+A with no selection selects every Screen",
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
    shard: "inspector-4b",
    file: "vector-live-edit-acceptance.spec.ts",
    title:
      "closing an edited pasted SVG restores authored fill opacity through history and reload",
  },
  {
    shard: "inspector-1b",
    file: "vector-live-edit-acceptance.spec.ts",
    title: "editing a resized pasted SVG keeps its frame and non-path sibling",
  },
  {
    shard: "drag-2a",
    file: "interaction-walkthrough-8.spec.ts",
    title: "Cmd+D duplicates every selected screen in one undo step",
  },
  {
    shard: "position-2b",
    file: "vector-live-edit-acceptance.spec.ts",
    title:
      "an open pasted SVG continues from its endpoint and closes without adding a fill",
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
    shard: "inspector-3b",
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
  {
    shard: "inspector-2",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard repeat paste moves relative roots 16px under an RTL containing block",
  },
  {
    shard: "inspector-2",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard paste preserves relative roots without an anchor across screens",
  },
  {
    shard: "drag-1a",
    file: "board-option-drag-placement.spec.ts",
    title:
      "an Option-drag copy dropped on empty board space between layers lands at the release point",
  },
  {
    shard: "drag-1b",
    file: "interaction-drag-reparent.spec.ts",
    title:
      "a screen layer dropped on the board stays there when the screen save's response is cut off",
  },
  {
    shard: "drag-2a",
    file: "drag-release-coordinates.spec.ts",
    title:
      "an Alt pressed after the last move does not copy at a release the move never reached",
  },
  {
    shard: "inspector-4b",
    file: "design-component-behavior.spec.ts",
    title:
      "redoing a duplicated component while the undo's save is in flight reads no missing node",
  },
] as const satisfies readonly DesignE2ERegressionPin[];

export function parseDesignE2ERegressionPins(
  source: string,
): DesignE2ERegressionPin[] {
  const ts = loadTypeScript();
  const sourceFile = ts.createSourceFile(
    "design-e2e-regression-pins.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (parseDiagnostics(sourceFile).length > 0) {
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
const TEST_LIFECYCLE_HOOKS = new Set([
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

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
  dynamicTitleFromLiteralForOf?: boolean;
  modifier?: string;
  line: number;
  suppressionKind: DesignE2ETestRegistration["suppressionKind"];
  suppressionReason?: string;
  suppressionFingerprint?: string;
  suppressionEvents: SuppressionFingerprintEvent[];
  suiteRuntimeScopes: SuppressionFingerprintEvent[][];
  suiteRuntimeReasons: string[][];
};

type SuppressionFingerprintEvent = {
  scope: "direct" | "runtime" | "suite" | "file" | "focus" | "unknown";
  modifier: string;
  callee: string;
  arguments: string[];
  conditions?: string[];
  callbackIdentity?: string;
};

type SuiteSuppression = {
  modifier: string;
  event: SuppressionFingerprintEvent;
};

type RegistrationWalkContext = {
  suiteSuppressions: SuiteSuppression[];
  currentTest?: MutableRegistration;
  testInfoBindings: Set<TypeScript.Node>;
  testInfoMaybeBindings: Set<TypeScript.Node>;
  callbackInvocations: ReadonlyMap<TypeScript.CallExpression, TestCallback>;
  callbackBindings: ReadonlyMap<TypeScript.Node, TestCallback>;
  suiteRuntimeScopes: SuppressionFingerprintEvent[][];
  suiteRuntimeReasons: string[][];
  unknownExecutionContext: boolean;
  unknownCallbackIdentities: string[];
  conditions: string[];
  insideSingletonLiteralForEach: boolean;
  literalForOfBindingGroups: ReadonlySet<TypeScript.Identifier>[];
  activeHelpers: Set<TypeScript.Node>;
};

function stableNodeText(
  node: TypeScript.Node,
  sourceFile: TypeScript.SourceFile,
  printer: TypeScript.Printer,
  ts: typeof TypeScript,
): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).trim();
}

function conditionContext(
  context: RegistrationWalkContext,
  label: string,
): RegistrationWalkContext {
  return { ...context, conditions: [...context.conditions, label] };
}

function suppressionFingerprint(
  events: readonly SuppressionFingerprintEvent[],
): string | undefined {
  if (events.length === 0) return undefined;
  const entries = events
    .map((event) =>
      JSON.stringify({
        scope: event.scope,
        modifier: event.modifier,
        callee: event.callee,
        arguments: event.arguments,
        ...(event.conditions === undefined
          ? {}
          : { conditions: event.conditions }),
        ...(event.callbackIdentity === undefined
          ? {}
          : { callbackIdentity: event.callbackIdentity }),
      }),
    )
    .sort();
  return `[${entries.join(",")}]`;
}

function suppressionFingerprintEvent(
  call: TypeScript.CallExpression,
  scope: SuppressionFingerprintEvent["scope"],
  modifier: string,
  sourceFile: TypeScript.SourceFile,
  printer: TypeScript.Printer,
  ts: typeof TypeScript,
  callbackArgument?: TypeScript.Expression,
  callbackIdentity?: string,
  conditions: readonly string[] = [],
): SuppressionFingerprintEvent {
  return {
    scope,
    modifier,
    callee: stableNodeText(call.expression, sourceFile, printer, ts),
    arguments: call.arguments
      .filter((argument) => argument !== callbackArgument)
      .map((argument) => stableNodeText(argument, sourceFile, printer, ts)),
    ...(conditions.length === 0 ? {} : { conditions: [...conditions] }),
    ...(callbackIdentity === undefined ? {} : { callbackIdentity }),
  };
}

function unknownSuppressionEvent(
  callbackIdentity: string,
  conditions: readonly string[] = [],
): SuppressionFingerprintEvent {
  return {
    scope: "unknown",
    modifier: "uninspected-callback",
    callee: "unknown-execution-context",
    arguments: [],
    ...(conditions.length === 0 ? {} : { conditions: [...conditions] }),
    callbackIdentity,
  };
}

function functionIdentity(
  node: TypeScript.Node,
  sourceFile: TypeScript.SourceFile,
  printer: TypeScript.Printer,
  ts: typeof TypeScript,
): string {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return `function:${node.name.text}`;
  }
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return `${ts.SyntaxKind[node.kind]}:${stableNodeText(node.name, sourceFile, printer, ts)}`;
  }
  if (ts.isFunctionExpression(node) && node.name) {
    return `function:${node.name.text}`;
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return `variable:${parent.name.text}`;
  }
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name
  ) {
    return `property:${stableNodeText(parent.name, sourceFile, printer, ts)}`;
  }
  return `anonymous:${ts.SyntaxKind[node.kind]}`;
}

function callbackTokenIdentity(
  expression: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  printer: TypeScript.Printer,
  ts: typeof TypeScript,
): string {
  const candidate = unwrapExpression(expression, ts);
  if (ts.isIdentifier(candidate)) return `identifier:${candidate.text}`;
  if (
    ts.isPropertyAccessExpression(candidate) ||
    ts.isElementAccessExpression(candidate)
  ) {
    return `reference:${stableNodeText(candidate, sourceFile, printer, ts)}`;
  }
  if (ts.isCallExpression(candidate)) {
    return `call:${stableNodeText(candidate.expression, sourceFile, printer, ts)}`;
  }
  if (ts.isConditionalExpression(candidate)) {
    return [
      "conditional",
      stableNodeText(candidate.condition, sourceFile, printer, ts),
      callbackTokenIdentity(candidate.whenTrue, sourceFile, printer, ts),
      callbackTokenIdentity(candidate.whenFalse, sourceFile, printer, ts),
    ].join(":");
  }
  if (isCallback(candidate, ts) || ts.isFunctionDeclaration(candidate)) {
    return functionIdentity(candidate, sourceFile, printer, ts);
  }
  return `expression:${ts.SyntaxKind[candidate.kind]}`;
}

function unwrapExpression(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): TypeScript.Expression {
  let candidate = expression;
  while (
    ts.isParenthesizedExpression(candidate) ||
    ts.isAsExpression(candidate) ||
    ts.isSatisfiesExpression(candidate) ||
    ts.isTypeAssertionExpression(candidate) ||
    ts.isNonNullExpression(candidate)
  ) {
    candidate = candidate.expression;
  }
  return candidate;
}

function constantStringExpression(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): string | undefined {
  const candidate = unwrapExpression(expression, ts);
  if (
    ts.isStringLiteral(candidate) ||
    ts.isNoSubstitutionTemplateLiteral(candidate)
  ) {
    return candidate.text;
  }
  if (
    ts.isBinaryExpression(candidate) &&
    candidate.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantStringExpression(candidate.left, ts);
    const right = constantStringExpression(candidate.right, ts);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function propertyPath(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): string[] {
  const candidate = unwrapExpression(expression, ts);
  if (ts.isIdentifier(candidate)) return [candidate.text];
  if (ts.isPropertyAccessExpression(candidate)) {
    const parentPath = propertyPath(candidate.expression, ts);
    return parentPath.length ? [...parentPath, candidate.name.text] : [];
  }
  if (ts.isElementAccessExpression(candidate) && candidate.argumentExpression) {
    const property = constantStringExpression(candidate.argumentExpression, ts);
    if (property === undefined) return [];
    const parentPath = propertyPath(candidate.expression, ts);
    return parentPath.length ? [...parentPath, property] : [];
  }
  return [];
}

function isKnownDesignE2ETestModule(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier === "@playwright/test" ||
    moduleSpecifier === "./rails" ||
    moduleSpecifier === "./rails.ts"
  );
}

type TestAlias =
  | { kind: "test"; path: string[] }
  | { kind: "playwright-default" }
  | { kind: "namespace" }
  | { kind: "unrecognized-namespace" }
  | { kind: "unrecognized-commonjs-namespace" }
  | { kind: "ordinary-namespace" };

type TestAliasResolver = {
  resolve(expression: TypeScript.Expression): string[];
  isAmbiguous(expression: TypeScript.Expression): boolean;
  isKnownModifierReference(expression: TypeScript.Expression): boolean;
  isUnrecognizedDynamicTestModifier(expression: TypeScript.Expression): boolean;
};

const UNKNOWN_COMMONJS_MODULE = "\0unknown-require-module";
const UNRECOGNIZED_COMMONJS_TEST_ROOT = "unrecognized-commonjs-test";

function isFunctionLikeNode(
  node: TypeScript.Node,
  ts: typeof TypeScript,
): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isLexicalScopeNode(
  node: TypeScript.Node,
  ts: typeof TypeScript,
): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    isFunctionLikeNode(node, ts)
  );
}

function nearestScope(
  node: TypeScript.Node,
  ts: typeof TypeScript,
  functionScopeOnly = false,
): TypeScript.Node {
  let candidate: TypeScript.Node | undefined = node;
  while (candidate) {
    if (
      ts.isSourceFile(candidate) ||
      (functionScopeOnly
        ? isFunctionLikeNode(candidate, ts)
        : isLexicalScopeNode(candidate, ts))
    ) {
      return candidate;
    }
    candidate = candidate.parent;
  }
  return node.getSourceFile();
}

function testImports(
  sourceFile: TypeScript.SourceFile,
  ts: typeof TypeScript,
): TestAliasResolver {
  const scopes = new WeakMap<
    TypeScript.Node,
    Map<string, TestAlias | undefined>
  >();
  const declarationCounts = new WeakMap<TypeScript.Node, Map<string, number>>();
  const importedNames = new WeakMap<TypeScript.Node, Set<string>>();
  const aliasDeclarations: Array<{
    scope: TypeScript.Node;
    name: string;
    initializer: TypeScript.Expression;
    property?: string;
  }> = [];
  const objectModifierAliasDeclarations: Array<{
    scope: TypeScript.Node;
    name: string;
    initializer: TypeScript.Expression;
  }> = [];
  const knownModifierObjects = new WeakMap<
    TypeScript.Node,
    Map<string, Set<string>>
  >();
  const writtenAliases = new WeakMap<TypeScript.Node, Set<string>>();
  const loopAuthorityAliases = new WeakMap<TypeScript.Node, Set<string>>();
  const loopAuthorityMemberTargets = new WeakMap<
    TypeScript.Node,
    Set<string>
  >();
  const loopHeadValueWrites: Array<{
    target: TypeScript.Node;
    iterable: TypeScript.Expression;
  }> = [];

  const scopeBindings = (scope: TypeScript.Node) => {
    let bindings = scopes.get(scope);
    if (!bindings) {
      bindings = new Map();
      scopes.set(scope, bindings);
    }
    return bindings;
  };
  const recordImport = (
    scope: TypeScript.Node,
    name: string,
    alias: TestAlias,
  ) => {
    const bindings = scopeBindings(scope);
    const imported = importedNames.get(scope) ?? new Set<string>();
    imported.add(name);
    importedNames.set(scope, imported);
    if (!bindings.has(name)) {
      bindings.set(name, alias);
      return;
    }
    const current = bindings.get(name);
    if (
      !current ||
      current.kind !== alias.kind ||
      (current.kind === "test" &&
        alias.kind === "test" &&
        (current.path.length !== alias.path.length ||
          current.path.some((segment, index) => segment !== alias.path[index])))
    ) {
      bindings.set(name, undefined);
    }
  };
  const recordDeclaration = (scope: TypeScript.Node, name: string) => {
    const bindings = scopeBindings(scope);
    const counts = declarationCounts.get(scope) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    declarationCounts.set(scope, counts);
    bindings.set(name, undefined);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      const moduleReference = ts.isExternalModuleReference(
        statement.moduleReference,
      )
        ? statement.moduleReference.expression
        : undefined;
      const moduleSpecifier =
        moduleReference && ts.isStringLiteral(moduleReference)
          ? moduleReference.text
          : undefined;
      recordImport(sourceFile, statement.name.text, {
        kind:
          moduleSpecifier === "node:test"
            ? "ordinary-namespace"
            : moduleSpecifier !== undefined &&
                isKnownDesignE2ETestModule(moduleSpecifier)
              ? "namespace"
              : moduleReference && !ts.isStringLiteral(moduleReference)
                ? "unrecognized-commonjs-namespace"
                : "unrecognized-namespace",
      });
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const moduleSpecifier = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
    const recognizedTestModule =
      moduleSpecifier !== undefined &&
      isKnownDesignE2ETestModule(moduleSpecifier);
    const isOrdinaryNodeTestModule = moduleSpecifier === "node:test";
    const namedBindings = statement.importClause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === "test") {
          recordImport(sourceFile, element.name.text, {
            kind: "test",
            path: [
              recognizedTestModule
                ? "test"
                : isOrdinaryNodeTestModule
                  ? "ordinary-test"
                  : "unrecognized-test",
            ],
          });
        } else {
          recordDeclaration(sourceFile, element.name.text);
        }
      }
    } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      recordImport(sourceFile, namedBindings.name.text, {
        kind: recognizedTestModule
          ? "namespace"
          : isOrdinaryNodeTestModule
            ? "ordinary-namespace"
            : "unrecognized-namespace",
      });
    }
    if (statement.importClause.name) {
      recordImport(
        sourceFile,
        statement.importClause.name.text,
        moduleSpecifier === "@playwright/test"
          ? { kind: "playwright-default" }
          : {
              kind: "test",
              path: [
                recognizedTestModule
                  ? "test"
                  : isOrdinaryNodeTestModule
                    ? "ordinary-test"
                    : "unrecognized-test",
              ],
            },
      );
    }
  }

  const recordBindingName = (
    name: TypeScript.BindingName,
    scope: TypeScript.Node,
  ) => {
    if (ts.isIdentifier(name)) {
      recordDeclaration(scope, name.text);
    } else if (
      ts.isObjectBindingPattern(name) ||
      ts.isArrayBindingPattern(name)
    ) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          recordBindingName(element.name, scope);
        }
      }
    }
  };
  const recordLoopHeadValueWrites = (
    name: TypeScript.BindingName,
    iterable: TypeScript.Expression,
  ) => {
    if (ts.isIdentifier(name)) {
      loopHeadValueWrites.push({ target: name, iterable });
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        recordLoopHeadValueWrites(element.name, iterable);
      }
    }
  };
  const collectBindings = (node: TypeScript.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const isVar =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
      const scope = nearestScope(node, ts, isVar);
      recordBindingName(node.name, scope);
      if (
        ts.isVariableDeclarationList(node.parent) &&
        ts.isForOfStatement(node.parent.parent)
      ) {
        recordLoopHeadValueWrites(node.name, node.parent.parent.expression);
      }
      if (ts.isIdentifier(node.name) && node.initializer) {
        aliasDeclarations.push({
          scope,
          name: node.name.text,
          initializer: node.initializer,
        });
        if (
          ts.isObjectLiteralExpression(unwrapExpression(node.initializer, ts))
        ) {
          objectModifierAliasDeclarations.push({
            scope,
            name: node.name.text,
            initializer: node.initializer,
          });
        }
      } else if (node.initializer && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name))
            continue;
          const propertyName = element.propertyName ?? element.name;
          const property =
            ts.isIdentifier(propertyName) ||
            ts.isStringLiteral(propertyName) ||
            ts.isNoSubstitutionTemplateLiteral(propertyName)
              ? propertyName.text
              : undefined;
          if (
            property === "test" ||
            (property && TEST_MODIFIERS.has(property))
          ) {
            aliasDeclarations.push({
              scope,
              name: element.name.text,
              initializer: node.initializer,
              property,
            });
          }
        }
      }
    } else if (
      isFunctionLikeNode(node, ts) &&
      "parameters" in node &&
      Array.isArray(node.parameters)
    ) {
      for (const parameter of node.parameters) {
        recordBindingName(parameter.name, nearestScope(node, ts));
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        recordBindingName(node.name, nearestScope(node.parent, ts));
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      recordBindingName(node.name, nearestScope(node.parent, ts));
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  const lookup = (name: string, at: TypeScript.Node): TestAlias | undefined => {
    let scope: TypeScript.Node | undefined = at;
    while (scope) {
      const bindings = scopes.get(scope);
      if (bindings?.has(name)) return bindings.get(name);
      scope = scope.parent;
    }
    return name === "test" ? { kind: "test", path: ["test"] } : undefined;
  };
  const bindingScope = (name: string, at: TypeScript.Node) => {
    let scope: TypeScript.Node | undefined = at;
    while (scope) {
      if (scopes.get(scope)?.has(name)) return scope;
      scope = scope.parent;
    }
    return undefined;
  };
  const resolveModuleSpecifier = (
    expression: TypeScript.Expression,
  ): string | undefined => {
    let candidate = unwrapExpression(expression, ts);
    if (ts.isAwaitExpression(candidate)) {
      candidate = unwrapExpression(candidate.expression, ts);
    }
    if (!ts.isCallExpression(candidate)) return undefined;
    const callee = unwrapExpression(candidate.expression, ts);
    const isRequire = ts.isIdentifier(callee) && callee.text === "require";
    const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
    if (!isRequire && !isDynamicImport) return undefined;
    return candidate.arguments.length === 1
      ? (constantStringExpression(candidate.arguments[0]!, ts) ??
          UNKNOWN_COMMONJS_MODULE)
      : UNKNOWN_COMMONJS_MODULE;
  };
  const loopAuthorityMemberTargetLength = (
    expression: TypeScript.Expression,
  ) => {
    const segments = propertyPath(expression, ts);
    if (segments.length < 2) return undefined;
    const root = rootIdentifier(expression, ts);
    if (!root) return undefined;
    const scope = bindingScope(root.text, root);
    const targets = scope && loopAuthorityMemberTargets.get(scope);
    if (!targets) return undefined;
    for (let length = segments.length; length > 1; length--) {
      if (targets.has(JSON.stringify(segments.slice(0, length)))) {
        return length;
      }
    }
    return undefined;
  };
  const resolver: TestAliasResolver = {
    resolve(expression) {
      const memberTargetLength = loopAuthorityMemberTargetLength(expression);
      if (memberTargetLength !== undefined) {
        return [
          "test",
          ...propertyPath(expression, ts).slice(memberTargetLength),
        ];
      }
      return normalizedTestPath(expression, lookup, ts, resolveModuleSpecifier);
    },
    isAmbiguous(expression) {
      if (loopAuthorityMemberTargetLength(expression) !== undefined) {
        return true;
      }
      const root = rootIdentifier(expression, ts);
      if (!root) return false;
      const scope = bindingScope(root.text, root);
      return (
        scope !== undefined &&
        (loopAuthorityAliases.get(scope)?.has(root.text) === true ||
          (aliasDeclarations.some(
            (declaration) =>
              declaration.scope === scope && declaration.name === root.text,
          ) &&
            (writtenAliases.get(scope)?.has(root.text) ?? false)))
      );
    },
    isKnownModifierReference(expression) {
      const candidate = unwrapExpression(expression, ts);
      if (
        ts.isElementAccessExpression(candidate) &&
        candidate.argumentExpression &&
        constantStringExpression(candidate.argumentExpression, ts) === undefined
      ) {
        const root = rootIdentifier(candidate.expression, ts);
        if (!root) return false;
        const scope = bindingScope(root.text, root);
        return (
          scope !== undefined &&
          knownModifierObjects.get(scope)?.has(root.text) === true
        );
      }
      const segments = propertyPath(expression, ts);
      if (segments.length !== 2) return false;
      const root = rootIdentifier(expression, ts);
      if (!root) return false;
      const scope = bindingScope(root.text, root);
      return (
        scope !== undefined &&
        (knownModifierObjects.get(scope)?.get(root.text)?.has(segments[1]!) ??
          false)
      );
    },
    isUnrecognizedDynamicTestModifier(expression) {
      const candidate = unwrapExpression(expression, ts);
      if (
        !ts.isElementAccessExpression(candidate) ||
        !candidate.argumentExpression ||
        constantStringExpression(candidate.argumentExpression, ts) !== undefined
      ) {
        return false;
      }
      const receiverPath = normalizedTestPath(
        candidate.expression,
        lookup,
        ts,
        resolveModuleSpecifier,
      );
      return (
        (receiverPath[0] === "unrecognized-test" ||
          receiverPath[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT) &&
        (receiverPath.length === 1 ||
          (receiverPath.length === 2 && receiverPath[1] === "describe"))
      );
    },
  };

  const markWrittenTarget = (target: TypeScript.Node) => {
    const candidate = unwrapExpression(target as TypeScript.Expression, ts);
    if (ts.isIdentifier(candidate)) {
      const scope = bindingScope(candidate.text, candidate);
      if (
        scope &&
        aliasDeclarations.some(
          (declaration) =>
            declaration.scope === scope && declaration.name === candidate.text,
        )
      ) {
        const names = writtenAliases.get(scope) ?? new Set<string>();
        names.add(candidate.text);
        writtenAliases.set(scope, names);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(candidate)) {
      for (const element of candidate.elements) {
        if (ts.isSpreadElement(element)) markWrittenTarget(element.expression);
        else if (!ts.isOmittedExpression(element)) markWrittenTarget(element);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(candidate)) {
      for (const property of candidate.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          markWrittenTarget(property.name);
        } else if (ts.isPropertyAssignment(property)) {
          markWrittenTarget(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          markWrittenTarget(property.expression);
        }
      }
      return;
    }
    if (
      (ts.isArrayBindingPattern(candidate) ||
        ts.isObjectBindingPattern(candidate)) &&
      candidate.elements
    ) {
      for (const element of candidate.elements) {
        if (ts.isBindingElement(element)) markWrittenTarget(element.name);
      }
      return;
    }
    if (
      ts.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      markWrittenTarget(candidate.left);
    }
  };
  const collectWrites = (node: TypeScript.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      markWrittenTarget(node.left);
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          markWrittenTarget(declaration.name);
        }
      } else {
        markWrittenTarget(node.initializer);
        if (ts.isForOfStatement(node)) {
          loopHeadValueWrites.push({
            target: node.initializer,
            iterable: node.expression,
          });
        }
      }
    }
    ts.forEachChild(node, collectWrites);
  };
  collectWrites(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const { scope, name, initializer, property } of aliasDeclarations) {
      const counts = declarationCounts.get(scope);
      if (counts?.get(name) !== 1 || importedNames.get(scope)?.has(name))
        continue;
      const candidate = resolver.resolve(initializer);
      if (candidate.length === 0) continue;
      if (property) candidate.push(property);
      const bindings = scopeBindings(scope);
      const current = bindings.get(name);
      if (!current) {
        bindings.set(name, { kind: "test", path: candidate });
        changed = true;
      } else if (
        current.kind !== "test" ||
        current.path.length !== candidate.length ||
        current.path.some((segment, index) => segment !== candidate[index])
      ) {
        bindings.set(name, undefined);
      }
    }
  }

  for (const { scope, name, initializer } of objectModifierAliasDeclarations) {
    if (
      declarationCounts.get(scope)?.get(name) !== 1 ||
      importedNames.get(scope)?.has(name) ||
      writtenAliases.get(scope)?.has(name)
    ) {
      continue;
    }
    const object = unwrapExpression(initializer, ts);
    if (!ts.isObjectLiteralExpression(object)) continue;
    const properties = new Set<string>();
    for (const member of object.properties) {
      if (!ts.isPropertyAssignment(member)) continue;
      const propertyName =
        ts.isIdentifier(member.name) ||
        ts.isStringLiteral(member.name) ||
        ts.isNoSubstitutionTemplateLiteral(member.name)
          ? member.name.text
          : ts.isComputedPropertyName(member.name)
            ? constantStringExpression(member.name.expression, ts)
            : undefined;
      if (!propertyName) continue;
      const path = resolver.resolve(member.initializer);
      if (
        (path.length === 2 &&
          path[0] === "test" &&
          TEST_MODIFIERS.has(path[1]!)) ||
        (path.length === 3 &&
          path[0] === "test" &&
          path[1] === "describe" &&
          TEST_MODIFIERS.has(path[2]!))
      ) {
        properties.add(propertyName);
      }
    }
    if (properties.size > 0) {
      const aliases = knownModifierObjects.get(scope) ?? new Map();
      aliases.set(name, properties);
      knownModifierObjects.set(scope, aliases);
    }
  }

  const markLoopAuthorityTarget = (target: TypeScript.Node) => {
    const candidate = unwrapExpression(target as TypeScript.Expression, ts);
    if (ts.isIdentifier(candidate)) {
      const scope = bindingScope(candidate.text, candidate);
      if (!scope) return;
      const names = loopAuthorityAliases.get(scope) ?? new Set<string>();
      names.add(candidate.text);
      loopAuthorityAliases.set(scope, names);
      scopeBindings(scope).set(candidate.text, {
        kind: "test",
        path: ["test"],
      });
      return;
    }
    if (
      ts.isArrayLiteralExpression(candidate) ||
      ts.isArrayBindingPattern(candidate)
    ) {
      for (const element of candidate.elements) {
        if (ts.isSpreadElement(element)) {
          markLoopAuthorityTarget(element.expression);
        } else if (ts.isBindingElement(element)) {
          markLoopAuthorityTarget(element.name);
        } else if (!ts.isOmittedExpression(element)) {
          markLoopAuthorityTarget(element);
        }
      }
      return;
    }
    if (
      ts.isObjectLiteralExpression(candidate) ||
      ts.isObjectBindingPattern(candidate)
    ) {
      const properties = ts.isObjectLiteralExpression(candidate)
        ? candidate.properties
        : candidate.elements;
      for (const property of properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          markLoopAuthorityTarget(property.name);
        } else if (ts.isPropertyAssignment(property)) {
          markLoopAuthorityTarget(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          markLoopAuthorityTarget(property.expression);
        } else if (ts.isBindingElement(property)) {
          markLoopAuthorityTarget(property.name);
        }
      }
      return;
    }
    if (
      ts.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      markLoopAuthorityTarget(candidate.left);
      return;
    }
    if (
      ts.isPropertyAccessExpression(candidate) ||
      ts.isElementAccessExpression(candidate)
    ) {
      const segments = propertyPath(candidate, ts);
      const root = rootIdentifier(candidate, ts);
      if (segments.length < 2 || !root) return;
      const scope = bindingScope(root.text, root);
      if (!scope) return;
      const targets =
        loopAuthorityMemberTargets.get(scope) ?? new Set<string>();
      targets.add(JSON.stringify(segments));
      loopAuthorityMemberTargets.set(scope, targets);
    }
  };
  for (const { target, iterable } of loopHeadValueWrites) {
    if (containsKnownPlaywrightAuthority(iterable, resolver, ts)) {
      markLoopAuthorityTarget(target);
    }
  }

  return resolver;
}

export function findDesignE2ESuppressionCallSites(
  source: string,
  file = "",
): Array<{
  modifier: "fixme" | "skip";
  start: number;
  end: number;
  line: number;
}> {
  const ts = loadTypeScript();
  const sourceName = file || "design.spec.ts";
  const sourceFile = ts.createSourceFile(
    sourceName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(sourceName, ts),
  );
  const diagnostics = parseDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0]!;
    const line =
      sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    throw new Error(
      `${file || "Design E2E source"}:${line}: TypeScript syntax error; test suppression callsites could not be inspected`,
    );
  }

  const aliases = testImports(sourceFile, ts);
  const isSuppressionPath = (segments: string[]): boolean =>
    (segments.length === 2 &&
      segments[0] === "test" &&
      (segments[1] === "fixme" || segments[1] === "skip")) ||
    (segments.length === 3 &&
      segments[0] === "test" &&
      segments[1] === "describe" &&
      (segments[2] === "fixme" || segments[2] === "skip"));
  const modifierForPath = (
    segments: string[],
  ): "fixme" | "skip" | undefined => {
    if (isSuppressionPath(segments)) return segments.at(-1) as "fixme" | "skip";
    if (segments.at(-1) === "bound") {
      const boundTarget = segments.slice(0, -1);
      if (isSuppressionPath(boundTarget)) {
        return boundTarget.at(-1) as "fixme" | "skip";
      }
    }
    if (segments.at(-1) === "call" || segments.at(-1) === "apply") {
      const calledTarget = segments.slice(0, -1);
      if (isSuppressionPath(calledTarget)) {
        return calledTarget.at(-1) as "fixme" | "skip";
      }
    }
    return undefined;
  };
  const modifierForInvocation = (
    expression: TypeScript.Expression,
  ): "fixme" | "skip" | undefined => {
    const modifier = modifierForPath(aliases.resolve(expression));
    if (modifier) return modifier;

    const candidate = unwrapExpression(expression, ts);
    if (!ts.isCallExpression(candidate)) return undefined;
    const wrapper = unwrapExpression(candidate.expression, ts);
    const wrapperName = ts.isPropertyAccessExpression(wrapper)
      ? wrapper.name.text
      : ts.isElementAccessExpression(wrapper) && wrapper.argumentExpression
        ? constantStringExpression(wrapper.argumentExpression, ts)
        : undefined;
    if (wrapperName !== "call" && wrapperName !== "apply") {
      return undefined;
    }
    const target =
      ts.isPropertyAccessExpression(wrapper) ||
      ts.isElementAccessExpression(wrapper)
        ? wrapper.expression
        : undefined;
    if (!target) return undefined;
    const targetPath = aliases.resolve(target);
    if (targetPath.at(-1) !== "bind") return undefined;
    const boundTarget = targetPath.slice(0, -1);
    return isSuppressionPath(boundTarget)
      ? (boundTarget.at(-1) as "fixme" | "skip")
      : undefined;
  };
  const hasDynamicTestModifier = (
    expression: TypeScript.Expression,
  ): boolean => {
    const candidate = unwrapExpression(expression, ts);
    if (
      ts.isElementAccessExpression(candidate) &&
      candidate.argumentExpression
    ) {
      if (
        constantStringExpression(candidate.argumentExpression, ts) !== undefined
      ) {
        return false;
      }
      const receiverPath = aliases.resolve(candidate.expression);
      return (
        (receiverPath.length === 1 && receiverPath[0] === "test") ||
        (receiverPath.length === 2 &&
          receiverPath[0] === "test" &&
          receiverPath[1] === "describe")
      );
    }
    const wrapped = ts.isCallExpression(candidate)
      ? unwrapExpression(candidate.expression, ts)
      : candidate;
    const wrapperName = ts.isPropertyAccessExpression(wrapped)
      ? wrapped.name.text
      : ts.isElementAccessExpression(wrapped) && wrapped.argumentExpression
        ? constantStringExpression(wrapped.argumentExpression, ts)
        : undefined;
    if (
      wrapperName !== "bind" &&
      wrapperName !== "call" &&
      wrapperName !== "apply"
    ) {
      return false;
    }
    const receiver =
      ts.isPropertyAccessExpression(wrapped) ||
      ts.isElementAccessExpression(wrapped)
        ? wrapped.expression
        : undefined;
    return receiver ? hasDynamicTestModifier(receiver) : false;
  };

  const callSites: Array<{
    modifier: "fixme" | "skip";
    start: number;
    end: number;
    line: number;
  }> = [];
  const seen = new Set<string>();
  const visit = (node: TypeScript.Node) => {
    if (ts.isCallExpression(node)) {
      const resolvedPath = aliases.resolve(node.expression);
      const modifier =
        modifierForPath(resolvedPath) ?? modifierForInvocation(node.expression);
      if (modifier) {
        if (aliases.isAmbiguous(node.expression)) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(
              node.expression.getStart(sourceFile),
            ).line + 1;
          throw new Error(
            `${file || "Design E2E source"}:${line}: ambiguous Playwright test.${modifier} callsite could not be inspected`,
          );
        }
        const start = node.expression.getStart(sourceFile);
        const end = node.expression.end;
        const range = `${start}:${end}`;
        if (!seen.has(range)) {
          seen.add(range);
          callSites.push({
            modifier,
            start,
            end,
            line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          });
        }
      } else if (
        (resolvedPath.length === 2 &&
          resolvedPath[0] === "test" &&
          resolvedPath[1] === "dynamic-bound") ||
        ((resolvedPath[0] === "unrecognized-test" ||
          resolvedPath[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT) &&
          modifierForPath(["test", ...resolvedPath.slice(1)]) !== undefined) ||
        hasDynamicTestModifier(node.expression) ||
        aliases.isKnownModifierReference(node.expression) ||
        aliases.isUnrecognizedDynamicTestModifier(node.expression)
      ) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(
            node.expression.getStart(sourceFile),
          ).line + 1;
        throw new Error(
          `${file || "Design E2E source"}:${line}: unsupported dynamic Playwright test modifier callsite could not be inspected`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return callSites;
}

function normalizedTestPath(
  expression: TypeScript.Expression,
  lookup: (name: string, at: TypeScript.Node) => TestAlias | undefined,
  ts: typeof TypeScript,
  resolveModuleSpecifier: (
    expression: TypeScript.Expression,
  ) => string | undefined,
): string[] {
  const candidate = unwrapExpression(expression, ts);
  const commonJsModulePath = (
    value: TypeScript.Expression,
  ): string[] | undefined => {
    const access = unwrapExpression(value, ts);
    const moduleSpecifier = resolveModuleSpecifier(access);
    if (moduleSpecifier !== undefined) {
      return ["commonjs-module", moduleSpecifier];
    }
    if (ts.isConditionalExpression(access)) {
      const whenTrue = commonJsModulePath(access.whenTrue);
      const whenFalse = commonJsModulePath(access.whenFalse);
      if (
        whenTrue &&
        whenFalse &&
        whenTrue.length === whenFalse.length &&
        whenTrue.every((segment, index) => segment === whenFalse[index])
      ) {
        return whenTrue;
      }
      if (whenTrue || whenFalse) {
        return ["commonjs-module", UNKNOWN_COMMONJS_MODULE];
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(access)) {
      const parentPath = commonJsModulePath(access.expression);
      return parentPath ? [...parentPath, access.name.text] : undefined;
    }
    if (ts.isElementAccessExpression(access) && access.argumentExpression) {
      const property = constantStringExpression(access.argumentExpression, ts);
      if (property === undefined) return undefined;
      const parentPath = commonJsModulePath(access.expression);
      return parentPath ? [...parentPath, property] : undefined;
    }
    return undefined;
  };
  const normalizeCommonJsPath = (path: string[]): string[] => {
    if (path[0] !== "commonjs-module") return path;
    const moduleSpecifier = path[1];
    const members = path.slice(2);
    if (members.length === 0) return path;
    if (members[0] !== "test") return [];
    const testRoot =
      moduleSpecifier === "node:test"
        ? "ordinary-test"
        : moduleSpecifier !== undefined &&
            isKnownDesignE2ETestModule(moduleSpecifier)
          ? "test"
          : UNRECOGNIZED_COMMONJS_TEST_ROOT;
    return [testRoot, ...members.slice(1)];
  };
  const samePath = (left: string[], right: string[]) =>
    left.length === right.length &&
    left.every((segment, index) => segment === right[index]);
  const conditionalTestPath = (
    conditional: TypeScript.ConditionalExpression,
  ): string[] => {
    const whenTrue = normalizedTestPath(
      conditional.whenTrue,
      lookup,
      ts,
      resolveModuleSpecifier,
    );
    const whenFalse = normalizedTestPath(
      conditional.whenFalse,
      lookup,
      ts,
      resolveModuleSpecifier,
    );
    if (samePath(whenTrue, whenFalse)) return whenTrue;
    return whenTrue[0] === "test" ||
      whenTrue[0] === "unrecognized-test" ||
      whenTrue[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT ||
      whenFalse[0] === "test" ||
      whenFalse[0] === "unrecognized-test" ||
      whenFalse[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT
      ? [
          whenTrue[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT ||
          whenFalse[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT
            ? UNRECOGNIZED_COMMONJS_TEST_ROOT
            : "unrecognized-test",
        ]
      : [];
  };

  const directCommonJsPath = commonJsModulePath(candidate);
  if (directCommonJsPath) {
    return normalizeCommonJsPath(directCommonJsPath);
  }
  if (ts.isConditionalExpression(candidate)) {
    return conditionalTestPath(candidate);
  }
  if (
    ts.isPropertyAccessExpression(candidate) ||
    ts.isElementAccessExpression(candidate)
  ) {
    const receiver = unwrapExpression(candidate.expression, ts);
    if (ts.isConditionalExpression(receiver)) {
      const property = ts.isPropertyAccessExpression(candidate)
        ? candidate.name.text
        : candidate.argumentExpression
          ? constantStringExpression(candidate.argumentExpression, ts)
          : undefined;
      const receiverPath = conditionalTestPath(receiver);
      if (property !== undefined && receiverPath.length > 0) {
        return normalizeCommonJsPath([...receiverPath, property]);
      }
    }
  }
  const inlineExtendedTestPath = (
    value: TypeScript.Expression,
  ): string[] | undefined => {
    const access = unwrapExpression(value, ts);
    if (ts.isCallExpression(access)) {
      const callee = unwrapExpression(access.expression, ts);
      const memberName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) && callee.argumentExpression
          ? constantStringExpression(callee.argumentExpression, ts)
          : undefined;
      if (memberName !== "extend") return undefined;
      const receiver =
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
          ? callee.expression
          : undefined;
      if (!receiver) return undefined;
      const receiverPath = normalizedTestPath(
        receiver,
        lookup,
        ts,
        resolveModuleSpecifier,
      );
      return receiverPath.length === 1 && receiverPath[0] === "test"
        ? ["test"]
        : undefined;
    }
    if (ts.isPropertyAccessExpression(access)) {
      const receiverPath = inlineExtendedTestPath(access.expression);
      return receiverPath ? [...receiverPath, access.name.text] : undefined;
    }
    if (ts.isElementAccessExpression(access) && access.argumentExpression) {
      const memberName = constantStringExpression(
        access.argumentExpression,
        ts,
      );
      if (memberName === undefined) return undefined;
      const receiverPath = inlineExtendedTestPath(access.expression);
      return receiverPath ? [...receiverPath, memberName] : undefined;
    }
    return undefined;
  };
  const inlineExtendedPath = inlineExtendedTestPath(candidate);
  if (inlineExtendedPath) return inlineExtendedPath;
  const isDynamicKnownTestModifier = (value: TypeScript.Expression) => {
    const access = unwrapExpression(value, ts);
    if (
      !ts.isElementAccessExpression(access) ||
      !access.argumentExpression ||
      constantStringExpression(access.argumentExpression, ts) !== undefined
    ) {
      return false;
    }
    const receiverPath = normalizedTestPath(
      access.expression,
      lookup,
      ts,
      resolveModuleSpecifier,
    );
    return (
      (receiverPath.length === 1 && receiverPath[0] === "test") ||
      (receiverPath.length === 2 &&
        receiverPath[0] === "test" &&
        receiverPath[1] === "describe")
    );
  };
  if (ts.isCallExpression(candidate)) {
    const boundFunction = unwrapExpression(candidate.expression, ts);
    const boundFunctionName = ts.isPropertyAccessExpression(boundFunction)
      ? boundFunction.name.text
      : ts.isElementAccessExpression(boundFunction) &&
          boundFunction.argumentExpression
        ? constantStringExpression(boundFunction.argumentExpression, ts)
        : undefined;
    const boundReceiver =
      ts.isPropertyAccessExpression(boundFunction) ||
      ts.isElementAccessExpression(boundFunction)
        ? boundFunction.expression
        : undefined;
    if (boundFunctionName === "bind" && boundReceiver) {
      if (isDynamicKnownTestModifier(boundReceiver)) {
        return ["test", "dynamic-bound"];
      }
      const boundPath = normalizedTestPath(
        boundReceiver,
        lookup,
        ts,
        resolveModuleSpecifier,
      );
      if (
        (boundPath.length === 2 &&
          boundPath[0] === "test" &&
          TEST_MODIFIERS.has(boundPath[1]!)) ||
        (boundPath.length === 3 &&
          boundPath[0] === "test" &&
          boundPath[1] === "describe" &&
          TEST_MODIFIERS.has(boundPath[2]!))
      ) {
        return [...boundPath, "bound"];
      }
    }
    const factoryPath = normalizedTestPath(
      candidate.expression,
      lookup,
      ts,
      resolveModuleSpecifier,
    );
    if (
      factoryPath.length === 2 &&
      factoryPath[0] === "test" &&
      factoryPath[1] === "dynamic-bound"
    ) {
      return factoryPath;
    }
    if (factoryPath.at(-1) === "bind") {
      const modifierPath = factoryPath.slice(0, -1);
      if (
        (modifierPath.length === 2 &&
          modifierPath[0] === "test" &&
          TEST_MODIFIERS.has(modifierPath[1]!)) ||
        (modifierPath.length === 3 &&
          modifierPath[0] === "test" &&
          modifierPath[1] === "describe" &&
          TEST_MODIFIERS.has(modifierPath[2]!))
      ) {
        return [...modifierPath, "bound"];
      }
    }
    if (factoryPath[0] === "test" && factoryPath.at(-1) === "extend") {
      return ["test"];
    }
  }
  const bindMemberName = ts.isPropertyAccessExpression(candidate)
    ? candidate.name.text
    : ts.isElementAccessExpression(candidate) && candidate.argumentExpression
      ? constantStringExpression(candidate.argumentExpression, ts)
      : undefined;
  if (
    bindMemberName === "bind" &&
    (ts.isPropertyAccessExpression(candidate) ||
      ts.isElementAccessExpression(candidate)) &&
    isDynamicKnownTestModifier(candidate.expression)
  ) {
    return ["test", "dynamic-bound"];
  }
  const segments = propertyPath(candidate, ts);
  const alias = lookup(segments[0] ?? "", candidate);
  if (alias?.kind === "playwright-default") {
    const members = segments.slice(1);
    return ["test", ...(members[0] === "test" ? members.slice(1) : members)];
  }
  if (alias?.kind === "test") {
    return normalizeCommonJsPath([...alias.path, ...segments.slice(1)]);
  }
  if (alias?.kind === "namespace" && segments[1] === "test") {
    return ["test", ...segments.slice(2)];
  }
  if (alias?.kind === "unrecognized-namespace" && segments[1] === "test") {
    return ["unrecognized-test", ...segments.slice(2)];
  }
  if (
    alias?.kind === "unrecognized-commonjs-namespace" &&
    segments[1] === "test"
  ) {
    return [UNRECOGNIZED_COMMONJS_TEST_ROOT, ...segments.slice(2)];
  }
  if (alias?.kind === "ordinary-namespace" && segments[1] === "test") {
    return ["ordinary-test", ...segments.slice(2)];
  }
  return [];
}

function testCallKind(
  call: TypeScript.CallExpression,
  aliases: TestAliasResolver,
  testInfoAliases: TestInfoAliasResolver,
  testInfoBindings: ReadonlySet<TypeScript.Node>,
  testInfoMaybeBindings: ReadonlySet<TypeScript.Node>,
  ts: typeof TypeScript,
):
  | {
      kind: "test" | "describe" | "runtime" | "hook";
      modifier?: string;
      uncertain?: boolean;
      uncertainty?: "playwright" | "test-info" | "unsupported-playwright";
    }
  | undefined {
  if (aliases.isKnownModifierReference(call.expression)) {
    return {
      kind: "runtime",
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  if (aliases.isUnrecognizedDynamicTestModifier(call.expression)) {
    return {
      kind: "runtime",
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  const segments = propertyPath(call.expression, ts);
  const testPath = aliases.resolve(call.expression);
  const expression = unwrapExpression(call.expression, ts);
  if (testPath[0] === "ordinary-test") return undefined;
  if (testPath[0] === UNRECOGNIZED_COMMONJS_TEST_ROOT) {
    const apiPath = testPath.slice(1);
    const modifier =
      apiPath.length === 1 && TEST_MODIFIERS.has(apiPath[0]!)
        ? apiPath[0]
        : apiPath.length === 2 &&
            apiPath[0] === "describe" &&
            TEST_MODIFIERS.has(apiPath[1]!)
          ? apiPath[1]
          : undefined;
    if (modifier) {
      return {
        kind: "runtime",
        modifier,
        uncertain: true,
        uncertainty: "unsupported-playwright",
      };
    }
    if (apiPath.length === 0) {
      return {
        kind: "test",
        uncertain: true,
        uncertainty: "unsupported-playwright",
      };
    }
    if (apiPath.length === 1 && apiPath[0] === "describe") {
      return {
        kind: "describe",
        uncertain: true,
        uncertainty: "unsupported-playwright",
      };
    }
    if (apiPath.length === 1 && TEST_LIFECYCLE_HOOKS.has(apiPath[0]!)) {
      return {
        kind: "hook",
        uncertain: true,
        uncertainty: "unsupported-playwright",
      };
    }
    return undefined;
  }
  if (testPath[0] === "unrecognized-test") {
    const modifierPath = testPath.slice(1);
    const modifier =
      modifierPath.length === 1 && TEST_MODIFIERS.has(modifierPath[0]!)
        ? modifierPath[0]
        : modifierPath.length === 2 &&
            modifierPath[0] === "describe" &&
            TEST_MODIFIERS.has(modifierPath[1]!)
          ? modifierPath[1]
          : undefined;
    if (!modifier) return undefined;
    return {
      kind: "runtime",
      modifier,
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  const testInfoReceiverStatus = (
    candidate: TypeScript.Expression,
  ): TestInfoAliasStatus => {
    const receiver = unwrapExpression(candidate, ts);
    if (
      ts.isCallExpression(receiver) &&
      aliases.resolve(receiver.expression).join(".") === "test.info"
    ) {
      return "known";
    }
    return testInfoAliases.isTestInfoExpression(
      receiver,
      testInfoBindings,
      testInfoMaybeBindings,
    );
  };
  const testInfoModifierFor = (candidate: TypeScript.Expression) => {
    const accessor = unwrapExpression(candidate, ts);
    if (ts.isPropertyAccessExpression(accessor)) {
      const status = testInfoReceiverStatus(accessor.expression);
      if (
        status !== "not-test-info" &&
        TEST_MODIFIERS.has(accessor.name.text)
      ) {
        return { modifier: accessor.name.text, status };
      }
      return undefined;
    }
    if (ts.isElementAccessExpression(accessor) && accessor.argumentExpression) {
      const status = testInfoReceiverStatus(accessor.expression);
      if (status === "not-test-info") return undefined;
      const property = constantStringExpression(
        accessor.argumentExpression,
        ts,
      );
      if (property === undefined) return { dynamic: true as const, status };
      if (TEST_MODIFIERS.has(property)) return { modifier: property, status };
    }
    return undefined;
  };
  const testInfoBoundModifierFor = (candidate: TypeScript.Expression) => {
    const boundCall = unwrapExpression(candidate, ts);
    if (ts.isIdentifier(boundCall)) {
      const alias = testInfoAliases.modifierAlias(
        boundCall,
        testInfoBindings,
        testInfoMaybeBindings,
      );
      return alias?.bound ? alias : undefined;
    }
    const boundFunction = ts.isCallExpression(boundCall)
      ? unwrapExpression(boundCall.expression, ts)
      : boundCall;
    const methodName = ts.isPropertyAccessExpression(boundFunction)
      ? boundFunction.name.text
      : ts.isElementAccessExpression(boundFunction) &&
          boundFunction.argumentExpression
        ? constantStringExpression(boundFunction.argumentExpression, ts)
        : undefined;
    const receiver =
      ts.isPropertyAccessExpression(boundFunction) ||
      ts.isElementAccessExpression(boundFunction)
        ? boundFunction.expression
        : undefined;
    if (methodName === "bind" && receiver) return testInfoModifierFor(receiver);
    if (ts.isCallExpression(boundCall) && ts.isIdentifier(boundFunction)) {
      const alias = testInfoAliases.modifierAlias(
        boundFunction,
        testInfoBindings,
        testInfoMaybeBindings,
      );
      return alias?.bound ? alias : undefined;
    }
    return undefined;
  };
  const isDynamicTestRootAccess = (candidate: TypeScript.Expression) => {
    const access = unwrapExpression(candidate, ts);
    if (
      !ts.isElementAccessExpression(access) ||
      !access.argumentExpression ||
      constantStringExpression(access.argumentExpression, ts) !== undefined
    ) {
      return false;
    }
    return aliases.resolve(access.expression).join(".") === "test";
  };
  const isDynamicKnownTestModifierAccess = (
    candidate: TypeScript.Expression,
  ) => {
    const access = unwrapExpression(candidate, ts);
    if (
      !ts.isElementAccessExpression(access) ||
      !access.argumentExpression ||
      constantStringExpression(access.argumentExpression, ts) !== undefined
    ) {
      return false;
    }
    const receiverPath = aliases.resolve(access.expression).join(".");
    return receiverPath === "test" || receiverPath === "test.describe";
  };
  const isBoundDynamicTestModifier = (candidate: TypeScript.Expression) => {
    const boundCall = unwrapExpression(candidate, ts);
    if (!ts.isCallExpression(boundCall)) return false;
    const boundFunction = unwrapExpression(boundCall.expression, ts);
    const methodName = ts.isPropertyAccessExpression(boundFunction)
      ? boundFunction.name.text
      : ts.isElementAccessExpression(boundFunction) &&
          boundFunction.argumentExpression
        ? constantStringExpression(boundFunction.argumentExpression, ts)
        : undefined;
    const receiver =
      ts.isPropertyAccessExpression(boundFunction) ||
      ts.isElementAccessExpression(boundFunction)
        ? boundFunction.expression
        : undefined;
    return (
      methodName === "bind" &&
      receiver !== undefined &&
      isDynamicKnownTestModifierAccess(receiver)
    );
  };
  const boundTestPath =
    testPath.at(-1) === "bound" ? testPath.slice(0, -1) : [];
  const testInfoBoundModifier = testInfoBoundModifierFor(expression);
  if (
    testInfoBoundModifier &&
    (testInfoBoundModifier.modifier ||
      ("dynamic" in testInfoBoundModifier && testInfoBoundModifier.dynamic))
  ) {
    return {
      kind: "runtime",
      ...(testInfoBoundModifier.modifier
        ? { modifier: testInfoBoundModifier.modifier }
        : {}),
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  if (
    isBoundDynamicTestModifier(expression) ||
    (testPath.length === 2 &&
      testPath[0] === "test" &&
      testPath[1] === "dynamic-bound")
  ) {
    return {
      kind: "runtime",
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  if (
    (boundTestPath.length === 2 &&
      boundTestPath[0] === "test" &&
      TEST_MODIFIERS.has(boundTestPath[1]!)) ||
    (boundTestPath.length === 3 &&
      boundTestPath[0] === "test" &&
      boundTestPath[1] === "describe" &&
      TEST_MODIFIERS.has(boundTestPath[2]!))
  ) {
    return {
      kind: "runtime",
      modifier: boundTestPath.at(-1),
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    (expression.name.text === "call" || expression.name.text === "apply")
  ) {
    const target = expression.expression;
    const targetPath = aliases.resolve(target);
    const dynamicBoundTarget =
      targetPath.length === 2 &&
      targetPath[0] === "test" &&
      targetPath[1] === "dynamic-bound";
    const boundTargetPath =
      targetPath.at(-1) === "bind" ? targetPath.slice(0, -1) : [];
    const testInfoModifier =
      testInfoBoundModifierFor(target) ?? testInfoModifierFor(target);
    let modifier =
      boundTargetPath.length === 2 &&
      boundTargetPath[0] === "test" &&
      TEST_MODIFIERS.has(boundTargetPath[1]!)
        ? boundTargetPath[1]
        : boundTargetPath.length === 3 &&
            boundTargetPath[0] === "test" &&
            boundTargetPath[1] === "describe" &&
            TEST_MODIFIERS.has(boundTargetPath[2]!)
          ? boundTargetPath[2]
          : targetPath.length === 2 && TEST_MODIFIERS.has(targetPath[1]!)
            ? targetPath[1]
            : targetPath.length === 3 &&
                targetPath[1] === "info" &&
                TEST_MODIFIERS.has(targetPath[2]!)
              ? targetPath[2]
              : undefined;
    const targetSegments = propertyPath(target, ts);
    const targetRoot = rootIdentifier(target, ts);
    if (!modifier && targetRoot && targetSegments.length === 2) {
      const status = testInfoAliases.isTestInfo(
        targetRoot,
        testInfoBindings,
        testInfoMaybeBindings,
      );
      if (
        status !== "not-test-info" &&
        TEST_MODIFIERS.has(targetSegments[1]!)
      ) {
        modifier = targetSegments[1];
      }
    } else if (!modifier && targetRoot && targetSegments.length === 1) {
      modifier = testInfoAliases.modifierAlias(
        targetRoot,
        testInfoBindings,
        testInfoMaybeBindings,
      )?.modifier;
    }
    if (
      dynamicBoundTarget ||
      modifier ||
      testInfoModifier?.modifier ||
      (testInfoModifier &&
        "dynamic" in testInfoModifier &&
        testInfoModifier.dynamic) ||
      isDynamicTestRootAccess(target)
    ) {
      return {
        kind: "runtime",
        ...((modifier ?? testInfoModifier?.modifier) === undefined
          ? {}
          : { modifier: modifier ?? testInfoModifier?.modifier }),
        uncertain: true,
        uncertainty: "unsupported-playwright",
      };
    }
  }
  if (isDynamicTestRootAccess(expression)) {
    return {
      kind: "runtime",
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  const testInfoModifier = testInfoModifierFor(expression);
  if (testInfoModifier?.dynamic) {
    return {
      kind: "runtime",
      uncertain: true,
      uncertainty: "unsupported-playwright",
    };
  }
  if (testInfoModifier?.modifier) {
    return {
      kind: "runtime",
      modifier: testInfoModifier.modifier,
      ...(testInfoModifier.status === "ambiguous"
        ? { uncertain: true, uncertainty: "test-info" as const }
        : {}),
    };
  }
  const aliasUncertainty = aliases.isAmbiguous(call.expression)
    ? { uncertain: true, uncertainty: "playwright" as const }
    : {};
  if (testPath.length === 1) return { kind: "test", ...aliasUncertainty };
  if (testPath.length === 2 && TEST_LIFECYCLE_HOOKS.has(testPath[1]!)) {
    return { kind: "hook", ...aliasUncertainty };
  }
  if (testPath.length === 2 && TEST_MODIFIERS.has(testPath[1]!)) {
    return { kind: "test", modifier: testPath[1], ...aliasUncertainty };
  }
  if (
    testPath.length === 3 &&
    testPath[1] === "info" &&
    TEST_MODIFIERS.has(testPath[2]!)
  ) {
    return { kind: "runtime", modifier: testPath[2], ...aliasUncertainty };
  }
  if (testPath.length === 2 && testPath[1] === "describe") {
    return { kind: "describe", ...aliasUncertainty };
  }
  if (
    testPath.length === 3 &&
    testPath[1] === "describe" &&
    (testPath[2] === "serial" || testPath[2] === "parallel")
  ) {
    return { kind: "describe", ...aliasUncertainty };
  }
  if (
    testPath.length === 3 &&
    testPath[1] === "describe" &&
    TEST_MODIFIERS.has(testPath[2]!)
  ) {
    return { kind: "describe", modifier: testPath[2], ...aliasUncertainty };
  }

  const originalExpression = call.expression;
  if (
    ts.isPropertyAccessExpression(originalExpression) &&
    TEST_MODIFIERS.has(originalExpression.name.text) &&
    ts.isCallExpression(originalExpression.expression)
  ) {
    const receiverPath = aliases.resolve(
      originalExpression.expression.expression,
    );
    if (receiverPath.length === 2 && receiverPath[1] === "info") {
      return { kind: "runtime", modifier: originalExpression.name.text };
    }
  }
  const testInfoRoot = rootIdentifier(expression, ts);
  if (segments.length === 1 && testInfoRoot) {
    const alias = testInfoAliases.modifierAlias(
      testInfoRoot,
      testInfoBindings,
      testInfoMaybeBindings,
    );
    if (alias) {
      return {
        kind: "runtime",
        modifier: alias.modifier,
        ...(alias.status === "ambiguous" ? { uncertain: true } : {}),
        ...(alias.status === "ambiguous"
          ? { uncertainty: "test-info" as const }
          : {}),
      };
    }
  }
  if (
    segments.length === 2 &&
    testInfoRoot &&
    TEST_MODIFIERS.has(segments[1]!)
  ) {
    const status = testInfoAliases.isTestInfo(
      testInfoRoot,
      testInfoBindings,
      testInfoMaybeBindings,
    );
    if (status === "known" || status === "ambiguous") {
      return {
        kind: "runtime",
        modifier: segments[1],
        ...(status === "ambiguous" ? { uncertain: true } : {}),
        ...(status === "ambiguous"
          ? { uncertainty: "test-info" as const }
          : {}),
      };
    }
  }
  return undefined;
}

function rootIdentifier(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): TypeScript.Identifier | undefined {
  let candidate = unwrapExpression(expression, ts);
  while (
    ts.isPropertyAccessExpression(candidate) ||
    ts.isElementAccessExpression(candidate)
  ) {
    candidate = candidate.expression;
  }
  return ts.isIdentifier(candidate) ? candidate : undefined;
}

function isCallback(
  node: TypeScript.Node,
  ts: typeof TypeScript,
): node is TypeScript.ArrowFunction | TypeScript.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function isTestCallbackArgument(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): boolean {
  let candidate = expression;
  while (
    ts.isParenthesizedExpression(candidate) ||
    ts.isAsExpression(candidate) ||
    ts.isSatisfiesExpression(candidate) ||
    ts.isTypeAssertionExpression(candidate) ||
    ts.isNonNullExpression(candidate)
  ) {
    candidate = candidate.expression;
  }
  return (
    isCallback(candidate, ts) ||
    ts.isIdentifier(candidate) ||
    ts.isCallExpression(candidate) ||
    ts.isPropertyAccessExpression(candidate) ||
    ts.isElementAccessExpression(candidate) ||
    ts.isConditionalExpression(candidate)
  );
}

function executedCallbackArgumentIndices(
  call: TypeScript.CallExpression,
  aliases: TestAliasResolver,
  ts: typeof TypeScript,
): number[] {
  const promiseCallbacks = promiseCallbackArgumentIndices(call, ts);
  if (promiseCallbacks.length > 0) return promiseCallbacks;
  if (aliases.resolve(call.expression).join(".") === "test.step") return [1];
  return literalArrayForEachIterations(call, ts) === 1 ? [0] : [];
}

function literalArrayForEachIterations(
  call: TypeScript.CallExpression,
  ts: typeof TypeScript,
): number | undefined {
  const callee = unwrapExpression(call.expression, ts);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "forEach")
    return undefined;
  const receiver = unwrapExpression(callee.expression, ts);
  if (!ts.isArrayLiteralExpression(receiver)) return undefined;
  if (receiver.elements.some(ts.isSpreadElement)) return undefined;
  return receiver.elements.filter((element) => !ts.isOmittedExpression(element))
    .length;
}

function literalArrayForEachElement(
  call: TypeScript.CallExpression,
  ts: typeof TypeScript,
): TypeScript.Expression | undefined {
  if (literalArrayForEachIterations(call, ts) !== 1) return undefined;
  const callee = unwrapExpression(call.expression, ts);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const receiver = unwrapExpression(callee.expression, ts);
  if (!ts.isArrayLiteralExpression(receiver)) return undefined;
  return receiver.elements.find(
    (element): element is TypeScript.Expression =>
      !ts.isOmittedExpression(element) && !ts.isSpreadElement(element),
  );
}

function promiseCallbackArgumentIndices(
  call: TypeScript.CallExpression,
  ts: typeof TypeScript,
): number[] {
  const callee = unwrapExpression(call.expression, ts);
  const method =
    ts.isPropertyAccessExpression(callee) && callee.name.text
      ? callee.name.text
      : ts.isElementAccessExpression(callee) &&
          callee.argumentExpression &&
          (ts.isStringLiteral(callee.argumentExpression) ||
            ts.isNoSubstitutionTemplateLiteral(callee.argumentExpression))
        ? callee.argumentExpression.text
        : undefined;
  if (method === "then") return [0, 1];
  if (method === "catch" || method === "finally") return [0];
  return [];
}

function modifierSuppression(
  call: TypeScript.CallExpression,
  sourceFile: TypeScript.SourceFile,
  modifier: string,
  ts: typeof TypeScript,
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

type LexicalBindingResolver = {
  resolve(identifier: TypeScript.Identifier): TypeScript.Identifier | undefined;
};

function lexicalTestBindings(
  sourceFile: TypeScript.SourceFile,
  ts: typeof TypeScript,
): LexicalBindingResolver {
  const scopeBindings = new WeakMap<
    TypeScript.Node,
    Map<string, TypeScript.Identifier | undefined>
  >();
  const recordBinding = (
    scope: TypeScript.Node,
    identifier: TypeScript.Identifier,
  ) => {
    let bindings = scopeBindings.get(scope);
    if (!bindings) {
      bindings = new Map();
      scopeBindings.set(scope, bindings);
    }
    if (bindings.has(identifier.text)) bindings.set(identifier.text, undefined);
    else bindings.set(identifier.text, identifier);
  };
  const recordBindingName = (
    name: TypeScript.BindingName,
    scope: TypeScript.Node,
  ) => {
    if (ts.isIdentifier(name)) {
      recordBinding(scope, name);
    } else {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          recordBindingName(element.name, scope);
        }
      }
    }
  };
  const collectBindings = (node: TypeScript.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const isVar =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
      recordBindingName(node.name, nearestScope(node, ts, isVar));
    } else if (
      isFunctionLikeNode(node, ts) &&
      "parameters" in node &&
      Array.isArray(node.parameters)
    ) {
      for (const parameter of node.parameters) {
        recordBindingName(parameter.name, nearestScope(node, ts));
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        recordBinding(nearestScope(node.parent, ts), node.name);
      } else if (
        (ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        recordBinding(nearestScope(node, ts), node.name);
      }
    } else if (
      (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name
    ) {
      recordBinding(nearestScope(node.parent, ts), node.name);
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) recordBinding(sourceFile, clause.name);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        recordBinding(sourceFile, bindings.name);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          recordBinding(sourceFile, element.name);
        }
      }
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  return {
    resolve(identifier) {
      let scope: TypeScript.Node | undefined = identifier;
      while (scope) {
        const bindings = scopeBindings.get(scope);
        if (bindings?.has(identifier.text))
          return bindings.get(identifier.text);
        scope = scope.parent;
      }
      return undefined;
    },
  };
}

function parseTestTitle(
  argument: TypeScript.Expression,
  sourceFile: TypeScript.SourceFile,
  bindings: LexicalBindingResolver,
  ts: typeof TypeScript,
): { title: string; dynamic: boolean } {
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return { title: argument.text, dynamic: false };
  }
  const candidate = unwrapExpression(argument, ts);
  if (ts.isIdentifier(candidate)) {
    const binding = bindings.resolve(candidate);
    const declaration = binding?.parent;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const initializer = unwrapExpression(declaration.initializer, ts);
      if (
        ts.isStringLiteral(initializer) ||
        ts.isNoSubstitutionTemplateLiteral(initializer)
      ) {
        return { title: initializer.text, dynamic: false };
      }
    }
  }
  const source = argument.getText(sourceFile);
  return {
    title: ts.isTemplateExpression(argument)
      ? `template:${source}`
      : `expression:${source}`,
    dynamic: true,
  };
}

function isStaticPrimitiveLiteral(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): boolean {
  const candidate = unwrapExpression(expression, ts);
  return (
    ts.isStringLiteral(candidate) ||
    ts.isNoSubstitutionTemplateLiteral(candidate) ||
    ts.isNumericLiteral(candidate) ||
    candidate.kind === ts.SyntaxKind.TrueKeyword ||
    candidate.kind === ts.SyntaxKind.FalseKeyword ||
    candidate.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isPrefixUnaryExpression(candidate) &&
      (candidate.operator === ts.SyntaxKind.PlusToken ||
        candidate.operator === ts.SyntaxKind.MinusToken) &&
      ts.isNumericLiteral(candidate.operand))
  );
}

function staticObjectPropertyName(
  name: TypeScript.PropertyName,
  ts: typeof TypeScript,
): string | undefined {
  if (
    ts.isComputedPropertyName(name) ||
    (!ts.isIdentifier(name) &&
      !ts.isStringLiteral(name) &&
      !ts.isNumericLiteral(name))
  ) {
    return undefined;
  }
  return name.text;
}

function isStaticLiteralData(
  expression: TypeScript.Expression,
  ts: typeof TypeScript,
): boolean {
  const candidate = unwrapExpression(expression, ts);
  if (isStaticPrimitiveLiteral(candidate, ts)) return true;
  if (ts.isArrayLiteralExpression(candidate)) {
    return candidate.elements.every(
      (element) =>
        !ts.isSpreadElement(element) &&
        !ts.isOmittedExpression(element) &&
        isStaticLiteralData(element, ts),
    );
  }
  if (!ts.isObjectLiteralExpression(candidate)) return false;
  const names = new Set<string>();
  return candidate.properties.every((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = staticObjectPropertyName(property.name, ts);
    if (name === undefined || names.has(name)) return false;
    names.add(name);
    return isStaticLiteralData(property.initializer, ts);
  });
}

function literalForOfTitleBindings(
  statement: TypeScript.ForOfStatement,
  ts: typeof TypeScript,
): Set<TypeScript.Identifier> | undefined {
  if (
    !ts.isVariableDeclarationList(statement.initializer) ||
    (statement.initializer.flags & ts.NodeFlags.Const) === 0 ||
    statement.initializer.declarations.length !== 1
  ) {
    return undefined;
  }
  const declaration = statement.initializer.declarations[0]!;
  if (!ts.isObjectBindingPattern(declaration.name)) return undefined;

  const iterable = unwrapExpression(statement.expression, ts);
  if (
    !ts.isArrayLiteralExpression(iterable) ||
    iterable.elements.length === 0 ||
    iterable.elements.some(
      (element) =>
        ts.isSpreadElement(element) ||
        ts.isOmittedExpression(element) ||
        !ts.isObjectLiteralExpression(unwrapExpression(element, ts)) ||
        !isStaticLiteralData(element, ts),
    )
  ) {
    return undefined;
  }

  const rows = iterable.elements.map((element) =>
    unwrapExpression(element, ts),
  );
  const titleBindings = new Set<TypeScript.Identifier>();
  for (const element of declaration.name.elements) {
    if (
      !ts.isBindingElement(element) ||
      element.dotDotDotToken ||
      element.initializer ||
      !ts.isIdentifier(element.name)
    ) {
      return undefined;
    }
    const field = element.propertyName
      ? staticObjectPropertyName(element.propertyName, ts)
      : element.name.text;
    if (field === undefined) return undefined;
    const everyRowHasPrimitiveField = rows.every((row) => {
      if (!ts.isObjectLiteralExpression(row)) return false;
      const values = row.properties.filter(
        (property): property is TypeScript.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          staticObjectPropertyName(property.name, ts) === field,
      );
      return (
        values.length === 1 &&
        isStaticPrimitiveLiteral(values[0]!.initializer, ts)
      );
    });
    if (everyRowHasPrimitiveField) titleBindings.add(element.name);
  }
  return titleBindings.size > 0 ? titleBindings : undefined;
}

function titleUsesOneLiteralForOfBindingGroup(
  argument: TypeScript.Expression,
  groups: readonly ReadonlySet<TypeScript.Identifier>[],
  bindings: LexicalBindingResolver,
  ts: typeof TypeScript,
): boolean {
  const candidate = unwrapExpression(argument, ts);
  if (!ts.isTemplateExpression(candidate)) return false;
  const resolvedBindings = candidate.templateSpans.map((span) =>
    ts.isIdentifier(span.expression)
      ? bindings.resolve(span.expression)
      : undefined,
  );
  return (
    resolvedBindings.length > 0 &&
    resolvedBindings.every((binding) => binding !== undefined) &&
    groups.some((group) =>
      resolvedBindings.every(
        (binding) => binding !== undefined && group.has(binding),
      ),
    )
  );
}

type TestCallback =
  | TypeScript.ArrowFunction
  | TypeScript.FunctionExpression
  | TypeScript.FunctionDeclaration;

type NamedTestCallback = TypeScript.Expression | TypeScript.FunctionDeclaration;

type NamedTestCallbackResolver = {
  binding(identifier: TypeScript.Identifier): TypeScript.Identifier | undefined;
  callback(binding: TypeScript.Identifier): NamedTestCallback | undefined;
};

function namedTestCallbacks(
  sourceFile: TypeScript.SourceFile,
  bindings: LexicalBindingResolver,
  ts: typeof TypeScript,
): NamedTestCallbackResolver {
  const callbackDeclarations = new WeakMap<
    TypeScript.Identifier,
    NamedTestCallback
  >();
  const writtenBindings = new Set<TypeScript.Identifier>();
  const lookupBinding = (identifier: TypeScript.Identifier) => {
    return bindings.resolve(identifier);
  };
  const markWrittenTarget = (target: TypeScript.Node) => {
    if (ts.isArrayBindingPattern(target) || ts.isObjectBindingPattern(target)) {
      for (const element of target.elements) {
        if (ts.isBindingElement(element)) markWrittenTarget(element.name);
      }
      return;
    }
    const candidate = unwrapExpression(target as TypeScript.Expression, ts);
    if (ts.isIdentifier(candidate)) {
      const binding = lookupBinding(candidate);
      if (binding) writtenBindings.add(binding);
    } else if (ts.isArrayLiteralExpression(candidate)) {
      for (const element of candidate.elements) {
        if (ts.isSpreadElement(element)) markWrittenTarget(element.expression);
        else if (!ts.isOmittedExpression(element)) markWrittenTarget(element);
      }
    } else if (ts.isObjectLiteralExpression(candidate)) {
      for (const property of candidate.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          markWrittenTarget(property.name);
        } else if (ts.isPropertyAssignment(property)) {
          markWrittenTarget(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          markWrittenTarget(property.expression);
        }
      }
    } else if (
      ts.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      markWrittenTarget(candidate.left);
    }
  };
  const collectWrites = (node: TypeScript.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      markWrittenTarget(node.left);
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          markWrittenTarget(declaration.name);
        }
      } else {
        markWrittenTarget(node.initializer);
      }
    }
    ts.forEachChild(node, collectWrites);
  };
  collectWrites(sourceFile);

  const visit = (node: TypeScript.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      callbackDeclarations.set(node.name, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      callbackDeclarations.set(node.name, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    binding(identifier) {
      return bindings.resolve(identifier);
    },
    callback(binding) {
      return writtenBindings.has(binding)
        ? undefined
        : callbackDeclarations.get(binding);
    },
  };
}

type LocalTestHelperResolver = {
  resolve(name: string, at: TypeScript.Node): TestCallback | undefined;
};

type TestInfoBinding = {
  node: TypeScript.Identifier;
  alias?: TypeScript.Identifier;
  mutable: boolean;
  testInfo?: boolean;
  containerProperties?: Map<string, TypeScript.Expression>;
  containerElements?: Array<TypeScript.Expression | undefined>;
  containerUnknownValues?: TypeScript.Expression[];
  modifierAlias?: {
    modifier: string;
    source?: TypeScript.Identifier;
    directTestInfo?: boolean;
    bound?: boolean;
  };
};

type TestInfoAliasStatus = "known" | "ambiguous" | "not-test-info";

type TestInfoAliasResolver = {
  bindingNode(identifier: TypeScript.Identifier): TypeScript.Node | undefined;
  modifierAlias(
    identifier: TypeScript.Identifier,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
  ):
    | {
        modifier: string;
        status: "known" | "ambiguous";
        bound?: boolean;
      }
    | undefined;
  isTestInfo(
    identifier: TypeScript.Identifier,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
    resolving?: Set<TypeScript.Node>,
  ): TestInfoAliasStatus;
  isTestInfoExpression(
    expression: TypeScript.Expression,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
  ): TestInfoAliasStatus;
};

function testInfoAliases(
  sourceFile: TypeScript.SourceFile,
  aliases: TestAliasResolver,
  ts: typeof TypeScript,
): TestInfoAliasResolver {
  const scopes = new WeakMap<
    TypeScript.Node,
    Map<string, TestInfoBinding | undefined>
  >();
  const declarationCounts = new WeakMap<TypeScript.Node, Map<string, number>>();

  const bind = (
    scope: TypeScript.Node,
    identifier: TypeScript.Identifier,
    alias?: TypeScript.Identifier,
    mutable = false,
    testInfo = false,
    modifierAlias?: TestInfoBinding["modifierAlias"],
    container?: Pick<
      TestInfoBinding,
      "containerProperties" | "containerElements" | "containerUnknownValues"
    >,
  ) => {
    let bindings = scopes.get(scope);
    if (!bindings) {
      bindings = new Map();
      scopes.set(scope, bindings);
    }
    const counts = declarationCounts.get(scope) ?? new Map<string, number>();
    const count = (counts.get(identifier.text) ?? 0) + 1;
    counts.set(identifier.text, count);
    declarationCounts.set(scope, counts);
    if (count === 1) {
      bindings.set(identifier.text, {
        node: identifier,
        alias,
        mutable,
        testInfo,
        modifierAlias,
        ...container,
      });
    } else bindings.set(identifier.text, undefined);
  };

  const bindName = (
    name: TypeScript.BindingName,
    scope: TypeScript.Node,
    mutable = false,
  ) => {
    if (ts.isIdentifier(name)) {
      bind(scope, name, undefined, mutable);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindName(element.name, scope, mutable);
    }
  };

  const lookupCollectedBinding = (identifier: TypeScript.Identifier) => {
    let scope: TypeScript.Node | undefined = identifier;
    while (scope) {
      const bindings = scopes.get(scope);
      if (bindings?.has(identifier.text)) return bindings.get(identifier.text);
      scope = scope.parent;
    }
    return undefined;
  };

  const literalContainer = (
    expression: TypeScript.Expression,
  ):
    | Pick<
        TestInfoBinding,
        "containerProperties" | "containerElements" | "containerUnknownValues"
      >
    | undefined => {
    const candidate = unwrapExpression(expression, ts);
    if (ts.isObjectLiteralExpression(candidate)) {
      const containerProperties = new Map<string, TypeScript.Expression>();
      const containerUnknownValues: TypeScript.Expression[] = [];
      for (const property of candidate.properties) {
        if (ts.isPropertyAssignment(property)) {
          const key =
            ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name) ||
            ts.isNoSubstitutionTemplateLiteral(property.name) ||
            ts.isNumericLiteral(property.name)
              ? property.name.text
              : ts.isComputedPropertyName(property.name)
                ? constantStringExpression(property.name.expression, ts)
                : undefined;
          if (key === undefined) {
            containerUnknownValues.push(property.initializer);
          } else {
            containerProperties.set(key, property.initializer);
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          containerProperties.set(property.name.text, property.name);
        } else if (ts.isSpreadAssignment(property)) {
          containerUnknownValues.push(property.expression);
        }
      }
      return { containerProperties, containerUnknownValues };
    }
    if (ts.isArrayLiteralExpression(candidate)) {
      const containerElements: Array<TypeScript.Expression | undefined> = [];
      const containerUnknownValues: TypeScript.Expression[] = [];
      for (const element of candidate.elements) {
        if (ts.isSpreadElement(element)) {
          containerUnknownValues.push(element.expression);
        } else {
          containerElements.push(
            ts.isOmittedExpression(element) ? undefined : element,
          );
        }
      }
      return { containerElements, containerUnknownValues };
    }
    return undefined;
  };

  const containerForExpression = (
    expression: TypeScript.Expression,
    resolving = new Set<TypeScript.Node>(),
  ):
    | Pick<
        TestInfoBinding,
        "containerProperties" | "containerElements" | "containerUnknownValues"
      >
    | undefined => {
    const candidate = unwrapExpression(expression, ts);
    const literal = literalContainer(candidate);
    if (literal) return literal;
    if (!ts.isIdentifier(candidate) || resolving.has(candidate))
      return undefined;
    const binding = lookupCollectedBinding(candidate);
    if (!binding) return undefined;
    if (
      binding.containerProperties ||
      binding.containerElements ||
      binding.containerUnknownValues
    ) {
      return binding;
    }
    if (!binding.alias) return undefined;
    resolving.add(candidate);
    const container = containerForExpression(binding.alias, resolving);
    resolving.delete(candidate);
    return container;
  };

  const containerValue = (
    container: Pick<
      TestInfoBinding,
      "containerProperties" | "containerElements"
    >,
    key: string,
  ): TypeScript.Expression | undefined => {
    if (container.containerProperties?.has(key)) {
      return container.containerProperties.get(key);
    }
    if (/^(0|[1-9]\d*)$/.test(key)) {
      return container.containerElements?.[Number(key)];
    }
    return undefined;
  };

  const containerValues = (
    container: Pick<
      TestInfoBinding,
      "containerProperties" | "containerElements" | "containerUnknownValues"
    >,
  ): TypeScript.Expression[] => [
    ...[...(container.containerProperties?.values() ?? [])],
    ...(container.containerElements?.filter(
      (value): value is TypeScript.Expression => value !== undefined,
    ) ?? []),
    ...(container.containerUnknownValues ?? []),
  ];

  const boundModifierAlias = (
    expression: TypeScript.Expression,
  ): NonNullable<TestInfoBinding["modifierAlias"]> | undefined => {
    const candidate = unwrapExpression(expression, ts);
    if (ts.isCallExpression(candidate)) {
      const callee = unwrapExpression(candidate.expression, ts);
      if (ts.isIdentifier(callee)) {
        const alias = lookupCollectedBinding(callee)?.modifierAlias;
        if (alias?.bound) return alias;
      }
    }
    const boundFunction = ts.isCallExpression(candidate)
      ? unwrapExpression(candidate.expression, ts)
      : candidate;
    const methodName = ts.isPropertyAccessExpression(boundFunction)
      ? boundFunction.name.text
      : ts.isElementAccessExpression(boundFunction) &&
          boundFunction.argumentExpression
        ? constantStringExpression(boundFunction.argumentExpression, ts)
        : undefined;
    if (methodName !== "bind") return undefined;
    const modifierAccess =
      ts.isPropertyAccessExpression(boundFunction) ||
      ts.isElementAccessExpression(boundFunction)
        ? unwrapExpression(boundFunction.expression, ts)
        : undefined;
    if (!modifierAccess) return undefined;
    const modifier = ts.isPropertyAccessExpression(modifierAccess)
      ? modifierAccess.name.text
      : ts.isElementAccessExpression(modifierAccess) &&
          modifierAccess.argumentExpression
        ? constantStringExpression(modifierAccess.argumentExpression, ts)
        : undefined;
    if (!modifier || !TEST_MODIFIERS.has(modifier)) return undefined;
    const receiver =
      ts.isPropertyAccessExpression(modifierAccess) ||
      ts.isElementAccessExpression(modifierAccess)
        ? unwrapExpression(modifierAccess.expression, ts)
        : undefined;
    if (receiver && ts.isIdentifier(receiver)) {
      return { modifier, source: receiver, bound: true };
    }
    if (
      receiver &&
      ts.isCallExpression(receiver) &&
      aliases.resolve(receiver.expression).join(".") === "test.info"
    ) {
      return { modifier, directTestInfo: true, bound: true };
    }
    return undefined;
  };

  const collect = (node: TypeScript.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const isVar =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
      const mutable =
        !ts.isVariableDeclarationList(node.parent) ||
        (node.parent.flags & ts.NodeFlags.Const) === 0;
      const scope = nearestScope(node, ts, isVar);
      if (ts.isIdentifier(node.name) && node.initializer) {
        const initializer = unwrapExpression(node.initializer, ts);
        const testInfoCall =
          ts.isCallExpression(initializer) &&
          aliases.resolve(initializer.expression).join(".") === "test.info";
        const boundModifier = boundModifierAlias(node.initializer);
        bind(
          scope,
          node.name,
          ts.isIdentifier(initializer) ? initializer : undefined,
          mutable,
          testInfoCall,
          boundModifier,
          literalContainer(initializer),
        );
      } else if (
        ts.isArrayBindingPattern(node.name) &&
        node.initializer &&
        ts.isArrayLiteralExpression(unwrapExpression(node.initializer, ts))
      ) {
        const initializer = unwrapExpression(
          node.initializer,
          ts,
        ) as TypeScript.ArrayLiteralExpression;
        for (const [index, element] of node.name.elements.entries()) {
          if (!ts.isBindingElement(element)) continue;
          const source = initializer.elements[index];
          if (!source || ts.isSpreadElement(source)) {
            bindName(element.name, scope, mutable);
            continue;
          }
          if (!ts.isIdentifier(element.name)) {
            if (ts.isObjectBindingPattern(element.name)) {
              const sourceValue = unwrapExpression(source, ts);
              const sourceContainer = containerForExpression(sourceValue);
              for (const nestedElement of element.name.elements) {
                if (!ts.isBindingElement(nestedElement)) continue;
                if (!ts.isIdentifier(nestedElement.name)) {
                  bindName(nestedElement.name, scope, mutable);
                  continue;
                }
                const propertyName =
                  nestedElement.propertyName ?? nestedElement.name;
                const key =
                  ts.isIdentifier(propertyName) ||
                  ts.isStringLiteral(propertyName) ||
                  ts.isNoSubstitutionTemplateLiteral(propertyName)
                    ? propertyName.text
                    : undefined;
                const nestedSource =
                  key && sourceContainer
                    ? containerValue(sourceContainer, key)
                    : undefined;
                if (!nestedSource) {
                  bindName(nestedElement.name, scope, mutable);
                  continue;
                }
                const value = unwrapExpression(nestedSource, ts);
                const testInfoCall =
                  ts.isCallExpression(value) &&
                  aliases.resolve(value.expression).join(".") === "test.info";
                bind(
                  scope,
                  nestedElement.name,
                  ts.isIdentifier(value) ? value : undefined,
                  mutable,
                  testInfoCall,
                  undefined,
                  literalContainer(value),
                );
              }
              continue;
            }
            bindName(element.name, scope, mutable);
            continue;
          }
          const value = unwrapExpression(source, ts);
          const testInfoCall =
            ts.isCallExpression(value) &&
            aliases.resolve(value.expression).join(".") === "test.info";
          bind(
            scope,
            element.name,
            ts.isIdentifier(value) ? value : undefined,
            mutable,
            testInfoCall,
            undefined,
            literalContainer(value),
          );
        }
      } else if (ts.isArrayBindingPattern(node.name)) {
        bindName(node.name, scope, mutable);
      } else if (ts.isObjectBindingPattern(node.name) && node.initializer) {
        const initializer = unwrapExpression(node.initializer, ts);
        const initializerContainer = containerForExpression(initializer);
        const directTestInfo =
          ts.isCallExpression(initializer) &&
          aliases.resolve(initializer.expression).join(".") === "test.info";
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element)) continue;
          if (!ts.isIdentifier(element.name)) {
            bindName(element.name, scope, mutable);
            continue;
          }
          const propertyName = element.propertyName ?? element.name;
          const modifier =
            ts.isIdentifier(propertyName) ||
            ts.isStringLiteral(propertyName) ||
            ts.isNoSubstitutionTemplateLiteral(propertyName)
              ? propertyName.text
              : undefined;
          if (!modifier || !TEST_MODIFIERS.has(modifier)) {
            const sourceValue =
              modifier && initializerContainer
                ? containerValue(initializerContainer, modifier)
                : undefined;
            if (sourceValue && ts.isIdentifier(element.name)) {
              const value = unwrapExpression(sourceValue, ts);
              const testInfoCall =
                ts.isCallExpression(value) &&
                aliases.resolve(value.expression).join(".") === "test.info";
              bind(
                scope,
                element.name,
                ts.isIdentifier(value) ? value : undefined,
                mutable,
                testInfoCall,
                undefined,
                literalContainer(value),
              );
            } else {
              bindName(element.name, scope, mutable);
            }
            continue;
          }
          bind(
            scope,
            element.name,
            undefined,
            mutable,
            false,
            ts.isIdentifier(initializer)
              ? { modifier, source: initializer }
              : directTestInfo
                ? { modifier, directTestInfo: true }
                : undefined,
          );
        }
      } else {
        bindName(node.name, scope, mutable);
      }
    } else if (
      isFunctionLikeNode(node, ts) &&
      "parameters" in node &&
      Array.isArray(node.parameters)
    ) {
      const parameterScope = nearestScope(node, ts);
      for (const parameter of node.parameters)
        bindName(parameter.name, parameterScope, true);
      if (
        (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
        node.name
      ) {
        bind(
          ts.isFunctionDeclaration(node)
            ? nearestScope(node.parent, ts)
            : parameterScope,
          node.name,
        );
      }
    } else if (
      (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name
    ) {
      bind(nearestScope(node.parent, ts), node.name);
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) bind(sourceFile, clause.name);
      const namedBindings = clause.namedBindings;
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        bind(sourceFile, namedBindings.name);
      } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements)
          bind(sourceFile, element.name);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const lookup = (name: string, at: TypeScript.Node) => {
    let scope: TypeScript.Node | undefined = at;
    while (scope) {
      const bindings = scopes.get(scope);
      if (bindings?.has(name)) {
        return { found: true as const, binding: bindings.get(name) };
      }
      scope = scope.parent;
    }
    return { found: false as const, binding: undefined };
  };

  const writtenBindings = new Set<TypeScript.Node>();
  const writtenContainerBindings = new Set<TypeScript.Node>();
  const loopHeadValueWrites: Array<{
    target: TypeScript.Node;
    iterable: TypeScript.Expression;
  }> = [];
  const markContainerWrite = (
    identifier: TypeScript.Identifier,
    resolving = new Set<TypeScript.Node>(),
  ) => {
    const binding = lookup(identifier.text, identifier).binding;
    if (!binding || resolving.has(binding.node)) return;
    if (!containerForExpression(identifier)) return;
    writtenContainerBindings.add(binding.node);
    if (binding.alias) {
      resolving.add(binding.node);
      markContainerWrite(binding.alias, resolving);
      resolving.delete(binding.node);
    }
  };
  const markAssignmentTarget = (target: TypeScript.Node) => {
    const candidate = unwrapExpression(target as TypeScript.Expression, ts);
    if (ts.isIdentifier(candidate)) {
      const result = lookup(candidate.text, candidate);
      if (result.binding) writtenBindings.add(result.binding.node);
      return;
    }
    if (
      ts.isPropertyAccessExpression(candidate) ||
      ts.isElementAccessExpression(candidate)
    ) {
      const root = rootIdentifier(candidate, ts);
      if (root) markContainerWrite(root);
      return;
    }
    if (ts.isArrayLiteralExpression(candidate)) {
      for (const element of candidate.elements) {
        if (ts.isSpreadElement(element))
          markAssignmentTarget(element.expression);
        else if (!ts.isOmittedExpression(element))
          markAssignmentTarget(element);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(candidate)) {
      for (const property of candidate.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          markAssignmentTarget(property.name);
        } else if (ts.isPropertyAssignment(property)) {
          markAssignmentTarget(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          markAssignmentTarget(property.expression);
        }
      }
      return;
    }
    if (
      ts.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      markAssignmentTarget(candidate.left);
    }
  };
  const collectWrites = (node: TypeScript.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      markAssignmentTarget(node.left);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand)
    ) {
      markAssignmentTarget(node.operand);
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (
        ts.isForOfStatement(node) &&
        ts.isVariableDeclarationList(node.initializer)
      ) {
        for (const declaration of node.initializer.declarations) {
          loopHeadValueWrites.push({
            target: declaration.name,
            iterable: node.expression,
          });
        }
      } else if (ts.isForOfStatement(node)) {
        loopHeadValueWrites.push({
          target: node.initializer,
          iterable: node.expression,
        });
      }
    }
    ts.forEachChild(node, collectWrites);
  };
  collectWrites(sourceFile);

  const isTestInfo: TestInfoAliasResolver["isTestInfo"] = (
    identifier,
    knownBindings,
    maybeBindings,
    resolving = new Set(),
  ) => {
    const result = lookup(identifier.text, identifier);
    if (!result.found)
      return identifier.text === "testInfo" ? "known" : "not-test-info";
    const binding = result.binding;
    if (!binding) return "ambiguous";
    if (resolving.has(binding.node)) return "ambiguous";
    if (maybeBindings.has(binding.node)) return "ambiguous";
    if (loopHeadWritesTestInfo(binding.node, knownBindings, maybeBindings))
      return "ambiguous";
    if (binding.testInfo)
      return writtenBindings.has(binding.node) ? "ambiguous" : "known";
    if (knownBindings.has(binding.node))
      return writtenBindings.has(binding.node) ? "ambiguous" : "known";
    if (!binding.alias)
      return binding.mutable && writtenBindings.has(binding.node)
        ? "ambiguous"
        : "not-test-info";
    resolving.add(binding.node);
    const status = isTestInfo(
      binding.alias,
      knownBindings,
      maybeBindings,
      resolving,
    );
    if (status !== "not-test-info" && writtenBindings.has(binding.node))
      return "ambiguous";
    return status;
  };
  const isTestInfoExpression = (
    expression: TypeScript.Expression,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
    resolving = new Set<TypeScript.Node>(),
  ): TestInfoAliasStatus => {
    const candidate = unwrapExpression(expression, ts);
    if (
      ts.isCallExpression(candidate) &&
      aliases.resolve(candidate.expression).join(".") === "test.info"
    ) {
      return "known";
    }
    if (ts.isIdentifier(candidate)) {
      return isTestInfo(candidate, knownBindings, maybeBindings, resolving);
    }
    if (
      !ts.isPropertyAccessExpression(candidate) &&
      !ts.isElementAccessExpression(candidate)
    ) {
      return "not-test-info";
    }
    const containerRoot = rootIdentifier(candidate.expression, ts);
    const containerBinding = containerRoot
      ? lookup(containerRoot.text, containerRoot).binding
      : undefined;
    if (
      containerBinding &&
      (writtenBindings.has(containerBinding.node) ||
        writtenContainerBindings.has(containerBinding.node) ||
        loopHeadWritesTestInfo(
          containerBinding.node,
          knownBindings,
          maybeBindings,
        ))
    ) {
      return "ambiguous";
    }

    const key = ts.isPropertyAccessExpression(candidate)
      ? candidate.name.text
      : candidate.argumentExpression
        ? (() => {
            const property = unwrapExpression(candidate.argumentExpression, ts);
            return ts.isNumericLiteral(property)
              ? property.text
              : constantStringExpression(property, ts);
          })()
        : undefined;
    const container = containerForExpression(candidate.expression);
    if (!container) return "not-test-info";
    if (key !== undefined) {
      const value = containerValue(container, key);
      if (value) {
        return isTestInfoExpression(
          value,
          knownBindings,
          maybeBindings,
          resolving,
        );
      }
      return (container.containerUnknownValues ?? []).some((value) =>
        containsTestInfoValue(value, knownBindings, maybeBindings),
      )
        ? "ambiguous"
        : "not-test-info";
    }
    return containerValues(container).some((value) =>
      containsTestInfoValue(value, knownBindings, maybeBindings),
    )
      ? "ambiguous"
      : "not-test-info";
  };
  const containsTestInfoValue = (
    expression: TypeScript.Expression,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
    seen = new Set<TypeScript.Node>(),
  ): boolean => {
    const candidate = unwrapExpression(expression, ts);
    if (seen.has(candidate)) return true;
    const status = isTestInfoExpression(
      candidate,
      knownBindings,
      maybeBindings,
    );
    if (status !== "not-test-info") return true;
    const container = containerForExpression(candidate);
    if (!container) return false;
    seen.add(candidate);
    const contains = containerValues(container).some((value) =>
      containsTestInfoValue(value, knownBindings, maybeBindings, seen),
    );
    seen.delete(candidate);
    return contains;
  };
  const staticPropertyValue = (
    expression: TypeScript.Expression,
    name: string,
  ): TypeScript.Expression | undefined => {
    const candidate = unwrapExpression(expression, ts);
    if (!ts.isObjectLiteralExpression(candidate)) return undefined;
    for (const property of candidate.properties) {
      if (ts.isPropertyAssignment(property)) {
        const propertyName =
          ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNoSubstitutionTemplateLiteral(property.name)
            ? property.name.text
            : undefined;
        if (propertyName === name) return property.initializer;
      } else if (
        ts.isShorthandPropertyAssignment(property) &&
        property.name.text === name
      ) {
        return property.name;
      }
    }
    return undefined;
  };
  const staticPropertyName = (name: TypeScript.PropertyName) =>
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
      ? name.text
      : undefined;
  const loopTargetReceivesTestInfo = (
    target: TypeScript.Node,
    value: TypeScript.Expression,
    bindingNode: TypeScript.Node,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
  ): boolean => {
    if (ts.isIdentifier(target)) {
      return (
        lookup(target.text, target).binding?.node === bindingNode &&
        containsTestInfoValue(value, knownBindings, maybeBindings)
      );
    }
    if (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)
    ) {
      const root = rootIdentifier(target, ts);
      return (
        root !== undefined &&
        lookup(root.text, root).binding?.node === bindingNode &&
        containsTestInfoValue(value, knownBindings, maybeBindings)
      );
    }
    if (
      ts.isArrayBindingPattern(target) ||
      ts.isArrayLiteralExpression(target)
    ) {
      const source = unwrapExpression(value, ts);
      if (!ts.isArrayLiteralExpression(source)) return false;
      const targets = target.elements;
      for (let index = 0; index < targets.length; index += 1) {
        const childTarget = targets[index];
        const childValue = source.elements[index];
        if (
          !childTarget ||
          ts.isOmittedExpression(childTarget) ||
          !childValue ||
          ts.isOmittedExpression(childValue) ||
          ts.isSpreadElement(childValue)
        ) {
          continue;
        }
        const nestedTarget = ts.isBindingElement(childTarget)
          ? childTarget.name
          : ts.isSpreadElement(childTarget)
            ? childTarget.expression
            : childTarget;
        if (
          loopTargetReceivesTestInfo(
            nestedTarget,
            childValue,
            bindingNode,
            knownBindings,
            maybeBindings,
          )
        ) {
          return true;
        }
      }
      return false;
    }
    if (ts.isObjectBindingPattern(target)) {
      for (const property of target.elements) {
        if (ts.isBindingElement(property)) {
          const propertyName =
            property.propertyName ??
            (ts.isIdentifier(property.name) ? property.name : undefined);
          const name = propertyName
            ? staticPropertyName(propertyName)
            : undefined;
          const childValue = name
            ? staticPropertyValue(value, name)
            : undefined;
          if (
            childValue &&
            loopTargetReceivesTestInfo(
              property.name,
              childValue,
              bindingNode,
              knownBindings,
              maybeBindings,
            )
          ) {
            return true;
          }
        }
      }
      return false;
    }
    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const childValue = staticPropertyValue(value, property.name.text);
          if (
            childValue &&
            loopTargetReceivesTestInfo(
              property.name,
              childValue,
              bindingNode,
              knownBindings,
              maybeBindings,
            )
          ) {
            return true;
          }
        } else if (ts.isPropertyAssignment(property)) {
          const name = staticPropertyName(property.name);
          const childValue = name
            ? staticPropertyValue(value, name)
            : undefined;
          if (
            childValue &&
            loopTargetReceivesTestInfo(
              property.initializer,
              childValue,
              bindingNode,
              knownBindings,
              maybeBindings,
            )
          ) {
            return true;
          }
        }
      }
      return false;
    }
    return false;
  };
  const resolvingLoopHeadWrites = new Set<TypeScript.Node>();
  const loopHeadWritesTestInfo = (
    bindingNode: TypeScript.Node,
    knownBindings: ReadonlySet<TypeScript.Node>,
    maybeBindings: ReadonlySet<TypeScript.Node>,
  ) => {
    if (resolvingLoopHeadWrites.has(bindingNode)) return true;
    for (const { target, iterable } of loopHeadValueWrites) {
      const values = unwrapExpression(iterable, ts);
      if (!ts.isArrayLiteralExpression(values)) continue;
      resolvingLoopHeadWrites.add(bindingNode);
      const receivesTestInfo = values.elements.some(
        (value) =>
          !ts.isOmittedExpression(value) &&
          !ts.isSpreadElement(value) &&
          loopTargetReceivesTestInfo(
            target,
            value,
            bindingNode,
            knownBindings,
            maybeBindings,
          ),
      );
      resolvingLoopHeadWrites.delete(bindingNode);
      if (receivesTestInfo) return true;
    }
    return false;
  };
  return {
    bindingNode(identifier) {
      const result = lookup(identifier.text, identifier);
      return result.binding?.node;
    },
    modifierAlias(identifier, knownBindings, maybeBindings) {
      const result = lookup(identifier.text, identifier);
      const binding = result.binding;
      const alias = binding?.modifierAlias;
      if (!binding || !alias) return undefined;
      const sourceStatus = alias.directTestInfo
        ? "known"
        : alias.source
          ? isTestInfo(alias.source, knownBindings, maybeBindings)
          : "not-test-info";
      if (sourceStatus === "not-test-info") return undefined;
      return {
        modifier: alias.modifier,
        ...(alias.bound ? { bound: true } : {}),
        status:
          sourceStatus === "ambiguous" || writtenBindings.has(binding.node)
            ? "ambiguous"
            : "known",
      };
    },
    isTestInfo,
    isTestInfoExpression(expression, knownBindings, maybeBindings) {
      return isTestInfoExpression(expression, knownBindings, maybeBindings);
    },
  };
}

function localTestHelpers(
  sourceFile: TypeScript.SourceFile,
  ts: typeof TypeScript,
): LocalTestHelperResolver {
  const scopes = new WeakMap<
    TypeScript.Node,
    Map<string, TestCallback | undefined>
  >();
  const declarationCounts = new WeakMap<TypeScript.Node, Map<string, number>>();

  const scopeBindings = (scope: TypeScript.Node) => {
    let bindings = scopes.get(scope);
    if (!bindings) {
      bindings = new Map();
      scopes.set(scope, bindings);
    }
    return bindings;
  };
  const bind = (
    scope: TypeScript.Node,
    name: string,
    helper?: TestCallback,
  ) => {
    const bindings = scopeBindings(scope);
    const counts = declarationCounts.get(scope) ?? new Map<string, number>();
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    declarationCounts.set(scope, counts);
    if (count === 1) bindings.set(name, helper);
    else bindings.set(name, undefined);
  };

  const bindName = (
    name: TypeScript.BindingName,
    scope: TypeScript.Node,
    helper?: TestCallback,
  ) => {
    if (ts.isIdentifier(name)) {
      bind(scope, name.text, helper);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindName(element.name, scope);
    }
  };

  const collect = (node: TypeScript.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      bind(
        nearestScope(node.parent, ts),
        node.name.text,
        node.body ? node : undefined,
      );
      const parameterScope = nearestScope(node, ts);
      for (const parameter of node.parameters) {
        bindName(parameter.name, parameterScope);
      }
    } else if (ts.isVariableDeclaration(node)) {
      const isVar =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
      const scope = nearestScope(node, ts, isVar);
      let helper: TestCallback | undefined;
      if (
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        const initializer = unwrapExpression(node.initializer, ts);
        if (
          ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer)
        ) {
          helper = initializer;
        }
      }
      bindName(node.name, scope, helper);
    } else if (
      isFunctionLikeNode(node, ts) &&
      "parameters" in node &&
      Array.isArray(node.parameters)
    ) {
      const scope = nearestScope(node, ts);
      for (const parameter of node.parameters) bindName(parameter.name, scope);
      if (ts.isFunctionExpression(node) && node.name) {
        bind(scope, node.name.text);
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      bind(nearestScope(node.parent, ts), node.name.text);
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const scope = sourceFile;
      if (node.importClause.name) bind(scope, node.importClause.name.text);
      const namedBindings = node.importClause.namedBindings;
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        bind(scope, namedBindings.name.text);
      } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          bind(scope, element.name.text);
        }
      }
    } else if (ts.isEnumDeclaration(node)) {
      bind(nearestScope(node.parent, ts), node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  return {
    resolve(name, at) {
      let scope: TypeScript.Node | undefined = at;
      while (scope) {
        const bindings = scopes.get(scope);
        if (bindings?.has(name)) return bindings.get(name);
        scope = scope.parent;
      }
      return undefined;
    },
  };
}

function helperUsesTestModifierParameter(
  helper: TypeScript.FunctionLikeDeclaration,
  parameter: TypeScript.ParameterDeclaration,
  aliases: TestInfoAliasResolver,
  ts: typeof TypeScript,
): boolean {
  if (!helper.body) return false;
  const parameterNames: TypeScript.Identifier[] = [];
  const collectParameterNames = (name: TypeScript.BindingName) => {
    if (ts.isIdentifier(name)) {
      parameterNames.push(name);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectParameterNames(element.name);
    }
  };
  collectParameterNames(parameter.name);
  const parameterBindings = new Set(
    parameterNames
      .map((name) => aliases.bindingNode(name))
      .filter((binding): binding is TypeScript.Node => binding !== undefined),
  );
  if (parameterBindings.size === 0) return false;
  let found = false;
  const inspect = (node: TypeScript.Node) => {
    if (found) return;
    if (
      ts.isIdentifier(node) &&
      parameterBindings.has(aliases.bindingNode(node) ?? node)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(helper.body);
  return found;
}

function isKnownPlaywrightAuthorityPath(path: string[]): boolean {
  return (
    (path.length === 1 && path[0] === "test") ||
    (path.length === 2 &&
      path[0] === "test" &&
      (path[1] === "describe" || TEST_MODIFIERS.has(path[1]!))) ||
    (path.length === 3 &&
      path[0] === "test" &&
      path[1] === "describe" &&
      TEST_MODIFIERS.has(path[2]!)) ||
    (path.length === 3 &&
      path[0] === "test" &&
      TEST_MODIFIERS.has(path[1]!) &&
      path[2] === "bound") ||
    (path.length === 4 &&
      path[0] === "test" &&
      path[1] === "describe" &&
      TEST_MODIFIERS.has(path[2]!) &&
      path[3] === "bound") ||
    (path.length === 2 && path[0] === "test" && path[1] === "dynamic-bound")
  );
}

function isKnownPlaywrightModifierAuthorityPath(path: string[]): boolean {
  return (
    (path.length === 2 && path[0] === "test" && TEST_MODIFIERS.has(path[1]!)) ||
    (path.length === 3 &&
      path[0] === "test" &&
      path[1] === "describe" &&
      TEST_MODIFIERS.has(path[2]!)) ||
    (path.length === 3 &&
      path[0] === "test" &&
      TEST_MODIFIERS.has(path[1]!) &&
      path[2] === "bound") ||
    (path.length === 4 &&
      path[0] === "test" &&
      path[1] === "describe" &&
      TEST_MODIFIERS.has(path[2]!) &&
      path[3] === "bound") ||
    (path.length === 2 && path[0] === "test" && path[1] === "dynamic-bound")
  );
}

function containsKnownPlaywrightAuthority(
  expression: TypeScript.Expression,
  aliases: TestAliasResolver,
  ts: typeof TypeScript,
): boolean {
  let found = false;
  const inspect = (node: TypeScript.Node) => {
    if (found || isFunctionLikeNode(node, ts)) return;
    const parent = node.parent;
    const isAccessReceiver =
      (parent &&
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node) ??
      false;
    const isPropertyName =
      parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
    const isDirectCallCallee =
      (parent && ts.isCallExpression(parent) && parent.expression === node) ??
      false;
    const isAssertionArgument =
      parent &&
      ts.isCallExpression(parent) &&
      parent.arguments.includes(node as TypeScript.Expression) &&
      ["expect", "assert"].includes(
        propertyPath(parent.expression, ts)[0] ?? "",
      );
    const isPlaywrightBindThisArgument =
      parent &&
      ts.isCallExpression(parent) &&
      parent.arguments[0] === node &&
      (() => {
        const callee = unwrapExpression(parent.expression, ts);
        if (
          !ts.isPropertyAccessExpression(callee) ||
          callee.name.text !== "bind"
        )
          return false;
        const receiver = aliases.resolve(callee.expression);
        return receiver[0] === "test" && receiver.length > 1;
      })();
    if (
      ts.isIdentifier(node) ||
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const candidate = node as TypeScript.Expression;
      if (
        !isAccessReceiver &&
        !isPropertyName &&
        !isDirectCallCallee &&
        !isAssertionArgument &&
        !isPlaywrightBindThisArgument &&
        isKnownPlaywrightAuthorityPath(aliases.resolve(candidate))
      ) {
        found = true;
        return;
      }
      const access = unwrapExpression(candidate, ts);
      if (
        !isAccessReceiver &&
        !isPropertyName &&
        !isDirectCallCallee &&
        !isAssertionArgument &&
        !isPlaywrightBindThisArgument &&
        ts.isElementAccessExpression(access) &&
        access.argumentExpression &&
        constantStringExpression(access.argumentExpression, ts) === undefined
      ) {
        const receiver = aliases.resolve(access.expression);
        if (
          (receiver.length === 1 && receiver[0] === "test") ||
          (receiver.length === 2 &&
            receiver[0] === "test" &&
            receiver[1] === "describe")
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(expression);
  return found;
}

function containsKnownPlaywrightModifierAuthority(
  expression: TypeScript.Expression,
  aliases: TestAliasResolver,
  ts: typeof TypeScript,
): boolean {
  let found = false;
  const inspect = (node: TypeScript.Node) => {
    if (found || isFunctionLikeNode(node, ts)) return;
    if (
      ts.isIdentifier(node) ||
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node)
    ) {
      const candidate = node as TypeScript.Expression;
      if (
        isKnownPlaywrightModifierAuthorityPath(aliases.resolve(candidate)) ||
        aliases.isKnownModifierReference(candidate)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(expression);
  return found;
}

function helperReturnsKnownPlaywrightAuthority(
  helper: TestCallback,
  aliases: TestAliasResolver,
  ts: typeof TypeScript,
): boolean {
  if (!helper.body) return false;
  const isKnownAuthority = (expression: TypeScript.Expression) =>
    isKnownPlaywrightAuthorityPath(aliases.resolve(expression)) ||
    containsKnownPlaywrightAuthority(expression, aliases, ts);
  if (!ts.isBlock(helper.body)) {
    return isKnownAuthority(helper.body);
  }
  let found = false;
  const inspect = (node: TypeScript.Node) => {
    if (found || (node !== helper.body && isFunctionLikeNode(node, ts))) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      isKnownAuthority(node.expression)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(helper.body);
  return found;
}

function resolveTestCallback(
  expression: TypeScript.Expression,
  callbacks: NamedTestCallbackResolver,
  ts: typeof TypeScript,
  resolving = new Set<TypeScript.Identifier>(),
): TestCallback | undefined {
  let candidate = expression;
  while (
    ts.isParenthesizedExpression(candidate) ||
    ts.isAsExpression(candidate) ||
    ts.isSatisfiesExpression(candidate) ||
    ts.isTypeAssertionExpression(candidate) ||
    ts.isNonNullExpression(candidate)
  ) {
    candidate = candidate.expression;
  }
  if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) {
    return candidate;
  }
  if (ts.isFunctionDeclaration(candidate) && candidate.body) return candidate;
  if (!ts.isIdentifier(candidate)) return undefined;
  const binding = callbacks.binding(candidate);
  if (!binding || resolving.has(binding)) return undefined;
  const callback = callbacks.callback(binding);
  if (!callback) return undefined;
  resolving.add(binding);
  if (ts.isFunctionDeclaration(callback)) {
    return callback.body ? callback : undefined;
  }
  return resolveTestCallback(callback, callbacks, ts, resolving);
}

type HelperCallbackUsage =
  | { kind: "invoked"; callSites: TypeScript.CallExpression[] }
  | { kind: "unused" }
  | { kind: "unknown" };

function hasDirectFunctionParameterType(
  parameter: TypeScript.ParameterDeclaration,
  ts: typeof TypeScript,
): boolean {
  return (
    parameter.type !== undefined &&
    (ts.isFunctionTypeNode(parameter.type) ||
      (ts.isTypeReferenceNode(parameter.type) &&
        parameter.type.typeName.getText() === "Function"))
  );
}

function helperCallbackUsage(
  helper: TestCallback,
  parameterIndex: number,
  ts: typeof TypeScript,
): HelperCallbackUsage {
  const parameter = helper.parameters[parameterIndex];
  if (!parameter || !ts.isIdentifier(parameter.name) || !helper.body) {
    return { kind: "unknown" };
  }

  const name = parameter.name.text;
  const callSites: TypeScript.CallExpression[] = [];
  let unknown = false;
  const hasName = (root: TypeScript.Node): boolean => {
    let found = false;
    const find = (node: TypeScript.Node) => {
      if (ts.isIdentifier(node) && node.text === name) found = true;
      if (!found) ts.forEachChild(node, find);
    };
    find(root);
    return found;
  };
  const scan = (node: TypeScript.Node) => {
    if (node !== helper.body && isFunctionLikeNode(node, ts)) {
      if (hasName(node)) unknown = true;
      return;
    }
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      if (parent && ts.isCallExpression(parent) && parent.expression === node) {
        callSites.push(parent);
      } else {
        unknown = true;
      }
    }
    ts.forEachChild(node, scan);
  };
  scan(helper.body);
  if (unknown) return { kind: "unknown" };
  return callSites.length > 0
    ? { kind: "invoked", callSites }
    : { kind: "unused" };
}

export function findDesignE2ETestRegistrations(
  source: string,
  file = "",
): DesignE2ETestRegistration[] {
  const ts = loadTypeScript();
  const sourceName = file || "design.spec.ts";
  const sourceFile = ts.createSourceFile(
    sourceName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(sourceName, ts),
  );
  const diagnostics = parseDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0]!;
    const line =
      sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    throw new Error(
      `${file || "Design E2E source"}:${line}: TypeScript syntax error; test identities could not be inspected`,
    );
  }

  const aliases = testImports(sourceFile, ts);
  const testInfoAliasResolver = testInfoAliases(sourceFile, aliases, ts);
  const printer = ts.createPrinter({ removeComments: true });
  const lexicalBindings = lexicalTestBindings(sourceFile, ts);
  const namedCallbacks = namedTestCallbacks(sourceFile, lexicalBindings, ts);
  const localHelpers = localTestHelpers(sourceFile, ts);
  const helperCallReturnsKnownPlaywrightAuthority = (
    expression: TypeScript.Expression,
    at: TypeScript.Node,
  ): boolean => {
    const call = unwrapExpression(expression, ts);
    if (!ts.isCallExpression(call)) return false;
    const callee = unwrapExpression(call.expression, ts);
    if (!ts.isIdentifier(callee)) return false;
    const helper = localHelpers.resolve(callee.text, at);
    return (
      helper !== undefined &&
      helperReturnsKnownPlaywrightAuthority(helper, aliases, ts)
    );
  };
  const resolveContextCallback = (
    expression: TypeScript.Expression,
    context: RegistrationWalkContext,
  ): TestCallback | undefined => {
    const callback = resolveTestCallback(expression, namedCallbacks, ts);
    if (callback) return callback;
    const candidate = unwrapExpression(expression, ts);
    if (!ts.isIdentifier(candidate)) return undefined;
    const binding = testInfoAliasResolver.bindingNode(candidate);
    return binding ? context.callbackBindings.get(binding) : undefined;
  };
  const resolvedCallbacks = new Set<TypeScript.Node>();
  const collectResolvedCallbacks = (node: TypeScript.Node) => {
    if (ts.isCallExpression(node)) {
      const classification = testCallKind(
        node,
        aliases,
        testInfoAliasResolver,
        new Set(),
        new Set(),
        ts,
      );
      if (
        classification?.kind === "test" ||
        classification?.kind === "describe" ||
        classification?.kind === "hook"
      ) {
        const callbackArgument = node.arguments.at(-1);
        const callback = callbackArgument
          ? resolveTestCallback(callbackArgument, namedCallbacks, ts)
          : undefined;
        if (callback) resolvedCallbacks.add(callback);
      }
      for (const index of executedCallbackArgumentIndices(node, aliases, ts)) {
        const argument = node.arguments[index];
        if (argument) {
          if (
            argument.kind === ts.SyntaxKind.NullKeyword ||
            (ts.isIdentifier(argument) && argument.text === "undefined") ||
            !isTestCallbackArgument(argument, ts)
          ) {
            continue;
          }
          const callback = resolveTestCallback(argument, namedCallbacks, ts);
          if (callback) resolvedCallbacks.add(callback);
        }
      }
      const callee = unwrapExpression(node.expression, ts);
      if (!classification && ts.isIdentifier(callee)) {
        const helper = localHelpers.resolve(callee.text, node);
        if (helper) {
          helper.parameters.forEach((_parameter, index) => {
            const argument = node.arguments[index];
            if (!argument) return;
            const usage = helperCallbackUsage(helper, index, ts);
            if (usage.kind === "unused") return;
            const callback = resolveTestCallback(argument, namedCallbacks, ts);
            if (callback) resolvedCallbacks.add(callback);
          });
        }
      }
    }
    ts.forEachChild(node, collectResolvedCallbacks);
  };
  collectResolvedCallbacks(sourceFile);
  const reachableHelpers = new Set<TypeScript.Node>();
  const expandedHelpers = new Set<TypeScript.Node>();
  const scanKnownExecution = (root: TypeScript.Node) => {
    const scanFunctionBody = (callback: TestCallback) => {
      if (ts.isFunctionDeclaration(callback)) {
        if (callback.body) scan(callback.body);
      } else {
        scan(callback.body);
      }
    };
    const scan = (node: TypeScript.Node): void => {
      if (isFunctionLikeNode(node, ts)) return;
      if (ts.isCallExpression(node)) {
        for (const index of executedCallbackArgumentIndices(
          node,
          aliases,
          ts,
        )) {
          const argument = node.arguments[index];
          if (argument) {
            if (
              argument.kind === ts.SyntaxKind.NullKeyword ||
              (ts.isIdentifier(argument) && argument.text === "undefined") ||
              !isTestCallbackArgument(argument, ts)
            ) {
              continue;
            }
            const callback = resolveTestCallback(argument, namedCallbacks, ts);
            if (callback) scanFunctionBody(callback);
          }
        }

        const classification = testCallKind(
          node,
          aliases,
          testInfoAliasResolver,
          new Set(),
          new Set(),
          ts,
        );
        if (
          classification?.kind === "test" ||
          classification?.kind === "describe" ||
          classification?.kind === "hook"
        ) {
          const callbackArgument = node.arguments.at(-1);
          const callback = callbackArgument
            ? resolveTestCallback(callbackArgument, namedCallbacks, ts)
            : undefined;
          if (callback) scanFunctionBody(callback);
          for (const argument of node.arguments) {
            if (argument !== callbackArgument) scan(argument);
          }
          return;
        }

        const callee = unwrapExpression(node.expression, ts);
        if (!classification && ts.isIdentifier(callee)) {
          const helper = localHelpers.resolve(callee.text, node);
          if (helper) {
            reachableHelpers.add(helper);
            helper.parameters.forEach((_parameter, index) => {
              const argument = node.arguments[index];
              if (!argument) return;
              const usage = helperCallbackUsage(helper, index, ts);
              if (usage.kind !== "invoked") return;
              const callback = resolveTestCallback(
                argument,
                namedCallbacks,
                ts,
              );
              if (callback) scanFunctionBody(callback);
            });
            if (!expandedHelpers.has(helper)) {
              expandedHelpers.add(helper);
              scanFunctionBody(helper);
            }
          }
        }
      }
      ts.forEachChild(node, scan);
    };
    if (isFunctionLikeNode(root, ts)) scanFunctionBody(root as TestCallback);
    else scan(root);
  };
  scanKnownExecution(sourceFile);
  const registrations: MutableRegistration[] = [];
  const fileSuppressions: SuppressionFingerprintEvent[] = [];
  const fileSuppressionReasons: string[] = [];
  const focusEvents: SuppressionFingerprintEvent[] = [];
  let hasFocus = false;
  const addRuntimeSuppressionEvent = (
    call: TypeScript.CallExpression,
    modifier: string,
    context: RegistrationWalkContext,
    reason?: string,
  ) => {
    const scope = context.currentTest
      ? "runtime"
      : context.suiteRuntimeScopes.length > 0
        ? "suite"
        : "file";
    const callbackIdentity = context.unknownCallbackIdentities.join("/");
    const event = suppressionFingerprintEvent(
      call,
      scope,
      modifier,
      sourceFile,
      printer,
      ts,
      undefined,
      callbackIdentity || undefined,
      context.conditions,
    );
    if (context.currentTest) {
      context.currentTest.suppressionEvents.push(event);
    } else if (!context.unknownExecutionContext) {
      const suiteScope = context.suiteRuntimeScopes.at(-1);
      if (suiteScope) {
        suiteScope.push(event);
        if (reason) context.suiteRuntimeReasons.at(-1)?.push(reason);
      } else {
        fileSuppressions.push(event);
        if (reason) fileSuppressionReasons.push(reason);
      }
    }
  };
  const throwUnsupportedModifierEscape = (node: TypeScript.Node): never => {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    const expression = node
      .getText(sourceFile)
      .replace(/\s+/g, " ")
      .slice(0, 120);
    throw new PinInspectionUnavailableError(
      `${file || "Design E2E source"}:${line}: Unable to inspect unsupported Playwright modifier invocation through an escaped value (${expression})`,
    );
  };
  const callbackMayAffectPin = (
    callback: TestCallback,
    context: RegistrationWalkContext,
    seenCallbacks = new Set<TypeScript.Node>(),
    seenHelpers = new Set<TypeScript.Node>(),
    suppressionsOnly = false,
  ): boolean => {
    if (seenCallbacks.has(callback)) return false;
    seenCallbacks.add(callback);
    let found = false;
    const inspectCallback = (candidate: TypeScript.Node) => {
      if (found) return;
      if (candidate !== callback && isFunctionLikeNode(candidate, ts)) return;
      if (ts.isCallExpression(candidate)) {
        const classification = testCallKind(
          candidate,
          aliases,
          testInfoAliasResolver,
          context.testInfoBindings,
          context.testInfoMaybeBindings,
          ts,
        );
        const callbackArgument = candidate.arguments.at(-1);
        const firstArgument = candidate.arguments[0];
        const resolvedRegistrationCallback = callbackArgument
          ? resolveTestCallback(callbackArgument, namedCallbacks, ts)
          : undefined;
        const registrationModifierOverload =
          classification?.kind === "test" &&
          classification.modifier !== undefined &&
          callbackArgument !== undefined &&
          isTestCallbackArgument(callbackArgument, ts) &&
          firstArgument !== undefined &&
          firstArgument.kind !== ts.SyntaxKind.TrueKeyword &&
          firstArgument.kind !== ts.SyntaxKind.FalseKeyword &&
          (ts.isStringLiteral(firstArgument) ||
            ts.isNoSubstitutionTemplateLiteral(firstArgument) ||
            resolvedRegistrationCallback !== undefined);
        const registrationCall =
          suppressionsOnly &&
          classification?.kind === "test" &&
          callbackArgument !== undefined &&
          isTestCallbackArgument(callbackArgument, ts) &&
          (classification.modifier === undefined ||
            registrationModifierOverload);
        if (
          !registrationCall &&
          (classification?.kind === "runtime" ||
            classification?.modifier !== undefined)
        ) {
          if (
            modifierSuppression(
              candidate,
              sourceFile,
              classification.modifier!,
              ts,
            ) !== undefined
          ) {
            found = true;
            return;
          }
        } else if (
          (classification?.kind === "test" ||
            classification?.kind === "describe" ||
            classification?.kind === "hook") &&
          !registrationCall
        ) {
          if (!suppressionsOnly || classification.kind === "hook") {
            found = true;
            return;
          }
        }

        const callee = unwrapExpression(candidate.expression, ts);
        const helper =
          !classification && ts.isIdentifier(callee)
            ? localHelpers.resolve(callee.text, candidate)
            : undefined;
        if (registrationCall) {
          // Registration callbacks are analyzed by the registration walk.
        } else if (helper) {
          if (!seenHelpers.has(helper)) {
            seenHelpers.add(helper);
            inspectCallback(helper.body!);
          }
          helper.parameters.forEach((_parameter, index) => {
            const argument = candidate.arguments[index];
            if (!argument) return;
            const usage = helperCallbackUsage(helper, index, ts);
            if (usage.kind === "unused") return;
            const nested = resolveContextCallback(argument, context);
            if (
              (nested &&
                callbackMayAffectPin(
                  nested,
                  context,
                  seenCallbacks,
                  seenHelpers,
                  suppressionsOnly,
                )) ||
              (!nested &&
                (usage.kind === "invoked" ||
                  hasDirectFunctionParameterType(
                    helper.parameters[index]!,
                    ts,
                  )))
            ) {
              found = true;
            }
          });
        } else {
          const callbackIndices = executedCallbackArgumentIndices(
            candidate,
            aliases,
            ts,
          );
          if (callbackIndices.length > 0) {
            for (const index of callbackIndices) {
              const argument = candidate.arguments[index];
              if (
                !argument ||
                argument.kind === ts.SyntaxKind.NullKeyword ||
                (ts.isIdentifier(argument) && argument.text === "undefined")
              ) {
                continue;
              }
              const nested = resolveContextCallback(argument, context);
              if (
                !nested ||
                callbackMayAffectPin(
                  nested,
                  context,
                  seenCallbacks,
                  seenHelpers,
                  suppressionsOnly,
                )
              ) {
                found = true;
                return;
              }
            }
          } else {
            for (const argument of candidate.arguments) {
              const nested = resolveContextCallback(argument, context);
              if (
                nested &&
                callbackMayAffectPin(
                  nested,
                  context,
                  seenCallbacks,
                  seenHelpers,
                  suppressionsOnly,
                )
              ) {
                found = true;
                return;
              }
            }
          }
        }
      }
      ts.forEachChild(candidate, inspectCallback);
    };
    inspectCallback(callback.body!);
    return found;
  };
  const visit = (
    node: TypeScript.Node,
    context: RegistrationWalkContext,
    visitFunctionBody = false,
  ) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (
        containsKnownPlaywrightAuthority(node.right, aliases, ts) ||
        containsKnownPlaywrightModifierAuthority(node.right, aliases, ts)
      ) {
        throwUnsupportedModifierEscape(node);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (containsKnownPlaywrightAuthority(node.initializer, aliases, ts) ||
        helperCallReturnsKnownPlaywrightAuthority(node.initializer, node))
    ) {
      const path = aliases.resolve(node.initializer);
      const isTestApiDestructure =
        ts.isObjectBindingPattern(node.name) &&
        ((path.length === 1 && path[0] === "test") ||
          (path.length === 2 &&
            path[0] === "test" &&
            path[1] === "describe")) &&
        node.name.elements.every(
          (element) =>
            ts.isBindingElement(element) &&
            !element.dotDotDotToken &&
            !ts.isComputedPropertyName(element.propertyName ?? element.name),
        );
      if (
        !isKnownPlaywrightAuthorityPath(path) ||
        (!ts.isIdentifier(node.name) && !isTestApiDestructure)
      ) {
        throwUnsupportedModifierEscape(node);
      }
    }

    if (
      !visitFunctionBody &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node))
    ) {
      for (const parameter of node.parameters) {
        if (
          parameter.initializer &&
          containsKnownPlaywrightAuthority(
            parameter.initializer,
            aliases,
            ts,
          ) &&
          helperUsesTestModifierParameter(
            node,
            parameter,
            testInfoAliasResolver,
            ts,
          )
        ) {
          throwUnsupportedModifierEscape(parameter.initializer);
        }
      }
      if (resolvedCallbacks.has(node) || reachableHelpers.has(node)) return;
      visit(
        node,
        {
          ...context,
          currentTest: undefined,
          unknownExecutionContext: true,
          unknownCallbackIdentities: [
            ...context.unknownCallbackIdentities,
            functionIdentity(node, sourceFile, printer, ts),
          ],
        },
        true,
      );
      return;
    }

    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, conditionContext(context, "try:body"));
      if (node.catchClause) {
        visit(node.catchClause, conditionContext(context, "try:catch"));
      }
      if (node.finallyBlock) {
        visit(node.finallyBlock, conditionContext(context, "try:finally"));
      }
      return;
    }

    if (ts.isIfStatement(node)) {
      visit(node.expression, context);
      const predicate = stableNodeText(
        node.expression,
        sourceFile,
        printer,
        ts,
      );
      visit(
        node.thenStatement,
        conditionContext(context, `if:true:${predicate}`),
      );
      if (node.elseStatement) {
        visit(
          node.elseStatement,
          conditionContext(context, `if:false:${predicate}`),
        );
      }
      return;
    }

    if (ts.isConditionalExpression(node)) {
      visit(node.condition, context);
      const predicate = stableNodeText(node.condition, sourceFile, printer, ts);
      visit(
        node.whenTrue,
        conditionContext(context, `conditional:true:${predicate}`),
      );
      visit(
        node.whenFalse,
        conditionContext(context, `conditional:false:${predicate}`),
      );
      return;
    }

    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        visit(node.left, context);
        const predicate = stableNodeText(node.left, sourceFile, printer, ts);
        const branch =
          operator === ts.SyntaxKind.AmpersandAmpersandToken
            ? "true"
            : operator === ts.SyntaxKind.BarBarToken
              ? "false"
              : "nullish";
        visit(
          node.right,
          conditionContext(context, `short-circuit:${branch}:${predicate}`),
        );
        return;
      }
    }

    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      const predicate = stableNodeText(
        node.expression,
        sourceFile,
        printer,
        ts,
      );
      if (ts.isWhileStatement(node)) {
        visit(node.expression, context);
        visit(node.statement, conditionContext(context, `while:${predicate}`));
      } else {
        visit(node.statement, conditionContext(context, `do:${predicate}`));
        visit(node.expression, context);
      }
      return;
    }

    if (ts.isForStatement(node)) {
      if (node.initializer) visit(node.initializer, context);
      if (node.condition) visit(node.condition, context);
      const predicate = node.condition
        ? stableNodeText(node.condition, sourceFile, printer, ts)
        : "true";
      visit(node.statement, conditionContext(context, `for:${predicate}`));
      if (node.incrementor) {
        visit(
          node.incrementor,
          conditionContext(context, `for-increment:${predicate}`),
        );
      }
      return;
    }

    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      visit(node.initializer, context);
      visit(node.expression, context);
      const iterable = stableNodeText(node.expression, sourceFile, printer, ts);
      let bodyContext = conditionContext(context, `iteration:${iterable}`);
      if (ts.isForOfStatement(node)) {
        const titleBindings = literalForOfTitleBindings(node, ts);
        if (titleBindings) {
          bodyContext = {
            ...bodyContext,
            literalForOfBindingGroups: [
              ...context.literalForOfBindingGroups,
              titleBindings,
            ],
          };
        }
      }
      visit(node.statement, bodyContext);
      return;
    }

    if (ts.isSwitchStatement(node)) {
      visit(node.expression, context);
      const discriminant = stableNodeText(
        node.expression,
        sourceFile,
        printer,
        ts,
      );
      for (const clause of node.caseBlock.clauses) {
        const clauseContext = ts.isCaseClause(clause)
          ? conditionContext(
              context,
              `switch:${discriminant}:case:${stableNodeText(clause.expression, sourceFile, printer, ts)}`,
            )
          : conditionContext(context, `switch:${discriminant}:default`);
        if (ts.isCaseClause(clause)) visit(clause.expression, context);
        for (const statement of clause.statements)
          visit(statement, clauseContext);
      }
      return;
    }

    if (ts.isCallExpression(node)) {
      const callbackInvocation = context.callbackInvocations.get(node);
      if (callbackInvocation) {
        visit(callbackInvocation, context, true);
        for (const argument of node.arguments) visit(argument, context);
        return;
      }

      const literalForEachCount = literalArrayForEachIterations(node, ts);
      const forEachCallbackArgument = node.arguments[0];
      if (literalForEachCount === 0 && forEachCallbackArgument) {
        visit(node.expression, context);
        for (const argument of node.arguments.slice(1))
          visit(argument, context);
        return;
      }
      if (literalForEachCount !== undefined && literalForEachCount > 1) {
        const callback = forEachCallbackArgument
          ? resolveTestCallback(forEachCallbackArgument, namedCallbacks, ts)
          : undefined;
        if (
          (forEachCallbackArgument &&
            isTestCallbackArgument(forEachCallbackArgument, ts) &&
            !callback) ||
          (callback && callbackMayAffectPin(callback, context))
        ) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          throw new PinInspectionUnavailableError(
            `${file || "Design E2E source"}:${line}: Unable to inspect test effects from a multi-element array forEach callback`,
          );
        }
      }

      const awaitedCallbackIndices = executedCallbackArgumentIndices(
        node,
        aliases,
        ts,
      );
      if (awaitedCallbackIndices.length > 0) {
        const callbackArguments = new Set<TypeScript.Expression>();
        for (const index of awaitedCallbackIndices) {
          const argument = node.arguments[index];
          if (!argument) continue;
          if (
            argument.kind === ts.SyntaxKind.NullKeyword ||
            (ts.isIdentifier(argument) && argument.text === "undefined") ||
            !isTestCallbackArgument(argument, ts)
          ) {
            continue;
          }
          const callback = resolveTestCallback(argument, namedCallbacks, ts);
          if (!callback) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(
                node.getStart(sourceFile),
              ).line + 1;
            throw new PinInspectionUnavailableError(
              `${file || "Design E2E source"}:${line}: Unable to inspect awaited callback body`,
            );
          }
          callbackArguments.add(argument);
          let callbackContext = context;
          const forEachElement =
            index === 0 ? literalArrayForEachElement(node, ts) : undefined;
          if (forEachElement) {
            callbackContext = {
              ...context,
              insideSingletonLiteralForEach: true,
            };
          }
          visit(callback, callbackContext, true);
        }
        visit(node.expression, context);
        for (const argument of node.arguments) {
          if (!callbackArguments.has(argument)) visit(argument, context);
        }
        return;
      }

      if (helperCallReturnsKnownPlaywrightAuthority(node.expression, node)) {
        throwUnsupportedModifierEscape(node.expression);
      }

      const classification = testCallKind(
        node,
        aliases,
        testInfoAliasResolver,
        context.testInfoBindings,
        context.testInfoMaybeBindings,
        ts,
      );
      if (
        !classification &&
        containsKnownPlaywrightModifierAuthority(node.expression, aliases, ts)
      ) {
        throwUnsupportedModifierEscape(node.expression);
      }
      const authorityCallee = unwrapExpression(node.expression, ts);
      const authorityHelper =
        !classification && ts.isIdentifier(authorityCallee)
          ? localHelpers.resolve(authorityCallee.text, node)
          : undefined;
      for (const [index, argument] of node.arguments.entries()) {
        if (
          !containsKnownPlaywrightAuthority(argument, aliases, ts) &&
          !helperCallReturnsKnownPlaywrightAuthority(argument, node)
        ) {
          continue;
        }
        const path = aliases.resolve(argument);
        const isApiObject =
          (path.length === 1 && path[0] === "test") ||
          (path.length === 2 && path[0] === "test" && path[1] === "describe");
        if (
          isApiObject &&
          authorityHelper?.parameters[index] &&
          !helperUsesTestModifierParameter(
            authorityHelper,
            authorityHelper.parameters[index]!,
            testInfoAliasResolver,
            ts,
          )
        ) {
          continue;
        }
        throwUnsupportedModifierEscape(argument);
      }
      if (
        classification?.uncertainty === "playwright" ||
        classification?.uncertainty === "unsupported-playwright"
      ) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        throw new PinInspectionUnavailableError(
          `${file || "Design E2E source"}:${line}: ${
            classification.uncertainty === "playwright"
              ? "Unable to inspect ambiguous Playwright API alias"
              : "Unable to inspect unsupported Playwright modifier invocation"
          }`,
        );
      }
      if (classification?.kind === "describe") {
        const callbackArgument = node.arguments.at(-1);
        const callback = callbackArgument
          ? resolveTestCallback(callbackArgument, namedCallbacks, ts)
          : undefined;
        if (!callback || !callbackArgument) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          throw new PinInspectionUnavailableError(
            `${file || "Design E2E source"}:${line}: Unable to inspect the test.describe callback body`,
          );
        }
        const suiteSuppressions = [...context.suiteSuppressions];
        if (classification.modifier) {
          const suiteEvent = suppressionFingerprintEvent(
            node,
            classification.modifier === "only" ? "focus" : "suite",
            classification.modifier,
            sourceFile,
            printer,
            ts,
            callbackArgument,
            undefined,
            context.conditions,
          );
          suiteSuppressions.push({
            modifier: classification.modifier,
            event: suiteEvent,
          });
          if (
            classification.modifier === "only" &&
            !context.unknownExecutionContext
          ) {
            hasFocus = true;
            focusEvents.push(suiteEvent);
          }
        }
        const suiteContext: RegistrationWalkContext = {
          ...context,
          suiteSuppressions,
          suiteRuntimeScopes: [...context.suiteRuntimeScopes, []],
          suiteRuntimeReasons: [...context.suiteRuntimeReasons, []],
        };
        for (const argument of node.arguments) {
          if (argument === callbackArgument) {
            visit(callback, suiteContext, true);
          } else {
            visit(argument, context);
          }
        }
        return;
      }

      if (classification?.kind === "hook") {
        const callbackArgument = node.arguments.at(-1);
        const callback = callbackArgument
          ? resolveTestCallback(callbackArgument, namedCallbacks, ts)
          : undefined;
        if (!callback || !callbackArgument) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          throw new PinInspectionUnavailableError(
            `${file || "Design E2E source"}:${line}: Unable to inspect the ${stableNodeText(node.expression, sourceFile, printer, ts)} callback body`,
          );
        }
        const testInfoBindings = new Set(context.testInfoBindings);
        const testInfoParameter = callback.parameters[1]?.name;
        if (testInfoParameter && ts.isIdentifier(testInfoParameter)) {
          testInfoBindings.add(testInfoParameter);
        }
        for (const argument of node.arguments) {
          if (argument === callbackArgument) {
            visit(
              callback,
              { ...context, currentTest: undefined, testInfoBindings },
              true,
            );
          } else {
            visit(argument, context);
          }
        }
        return;
      }

      if (classification?.kind === "test") {
        const callbackArgument = node.arguments.at(-1);
        const callbackArgumentIdentity = callbackArgument
          ? parseTestTitle(callbackArgument, sourceFile, lexicalBindings, ts)
          : undefined;
        const callbackCandidate =
          callbackArgument !== undefined &&
          isTestCallbackArgument(callbackArgument, ts) &&
          callbackArgumentIdentity?.dynamic !== false;
        const resolvedCallback =
          callbackCandidate && callbackArgument
            ? resolveTestCallback(callbackArgument, namedCallbacks, ts)
            : undefined;
        const firstArgument = node.arguments[0];
        const firstArgumentIdentity = firstArgument
          ? parseTestTitle(firstArgument, sourceFile, lexicalBindings, ts)
          : undefined;
        const booleanConditionModifier =
          classification.modifier !== undefined &&
          (firstArgument?.kind === ts.SyntaxKind.TrueKeyword ||
            firstArgument?.kind === ts.SyntaxKind.FalseKeyword);
        const literalTitleModifier =
          classification.modifier !== undefined &&
          firstArgument !== undefined &&
          firstArgumentIdentity !== undefined &&
          !firstArgumentIdentity.dynamic;
        const unresolvedConditionModifier =
          classification.modifier !== undefined &&
          !booleanConditionModifier &&
          !literalTitleModifier &&
          resolvedCallback === undefined;
        if (
          classification.modifier !== undefined &&
          callbackCandidate &&
          resolvedCallback === undefined &&
          firstArgument !== undefined &&
          !booleanConditionModifier &&
          !literalTitleModifier
        ) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          throw new PinInspectionUnavailableError(
            `${file || "Design E2E source"}:${line}: Unable to inspect an ambiguous test.${classification.modifier} registration with an unresolved callback`,
          );
        }
        const hasCallbackArgument =
          callbackCandidate &&
          !booleanConditionModifier &&
          !unresolvedConditionModifier;
        const callback = hasCallbackArgument ? resolvedCallback : undefined;
        if (!context.currentTest && hasCallbackArgument && callbackArgument) {
          const titleArgument = node.arguments[0];
          if (!titleArgument) {
            throw new Error(
              `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}: test registration has no title`,
            );
          }
          if (
            context.insideSingletonLiteralForEach &&
            !ts.isStringLiteral(titleArgument) &&
            !ts.isNoSubstitutionTemplateLiteral(titleArgument)
          ) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(
                node.getStart(sourceFile),
              ).line + 1;
            throw new PinInspectionUnavailableError(
              `${file || "Design E2E source"}:${line}: Unable to inspect a registration title that depends on forEach item or is not a literal`,
            );
          }
          const identity =
            firstArgumentIdentity ??
            parseTestTitle(titleArgument, sourceFile, lexicalBindings, ts);
          const directReason = classification.modifier
            ? modifierSuppression(node, sourceFile, classification.modifier, ts)
            : undefined;
          const suiteModifier = context.suiteSuppressions.find(
            ({ modifier }) => modifier !== "only",
          )?.modifier;
          const suiteReason = suiteModifier
            ? `enclosing test.describe.${suiteModifier} can suppress this test`
            : undefined;
          const callbackInspectionReason = callback
            ? undefined
            : "Unable to inspect the test callback body";
          const executionInspectionReason = context.unknownExecutionContext
            ? "Unable to inspect test registration in an uninvoked function body"
            : undefined;
          const inspectionReason =
            callbackInspectionReason ?? executionInspectionReason;
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          const directEvent = classification.modifier
            ? suppressionFingerprintEvent(
                node,
                "direct",
                classification.modifier,
                sourceFile,
                printer,
                ts,
                callbackArgument,
                undefined,
                context.conditions,
              )
            : undefined;
          const item: MutableRegistration = {
            file,
            ...identity,
            ...(titleUsesOneLiteralForOfBindingGroup(
              titleArgument,
              context.literalForOfBindingGroups,
              lexicalBindings,
              ts,
            )
              ? { dynamicTitleFromLiteralForOf: true }
              : {}),
            line,
            ...(classification.modifier === undefined
              ? {}
              : { modifier: classification.modifier }),
            suppressionKind: directReason
              ? "direct"
              : suiteReason
                ? "suite"
                : inspectionReason
                  ? "runtime"
                  : null,
            ...((directReason ?? suiteReason ?? inspectionReason)
              ? {
                  suppressionReason:
                    directReason ?? suiteReason ?? inspectionReason,
                }
              : {}),
            suppressionEvents: [
              ...context.suiteSuppressions.map(({ event }) => event),
              ...context.unknownCallbackIdentities.map((identity) =>
                unknownSuppressionEvent(identity, context.conditions),
              ),
              ...(directEvent ? [directEvent] : []),
              ...(!callback && callbackArgument
                ? [
                    unknownSuppressionEvent(
                      callbackTokenIdentity(
                        callbackArgument,
                        sourceFile,
                        printer,
                        ts,
                      ),
                      context.conditions,
                    ),
                  ]
                : []),
            ],
            suiteRuntimeScopes: context.suiteRuntimeScopes,
            suiteRuntimeReasons: context.suiteRuntimeReasons,
          };
          if (
            classification.modifier === "only" &&
            !context.unknownExecutionContext
          ) {
            hasFocus = true;
            focusEvents.push(
              suppressionFingerprintEvent(
                node,
                "focus",
                "only",
                sourceFile,
                printer,
                ts,
                callbackArgument,
                undefined,
                context.conditions,
              ),
            );
          }
          registrations.push(item);

          const testInfoBindings = new Set(context.testInfoBindings);
          const testInfoParameter = callback?.parameters[1]?.name;
          if (testInfoParameter && ts.isIdentifier(testInfoParameter)) {
            testInfoBindings.add(testInfoParameter);
          }
          for (const argument of node.arguments) {
            if (argument === callbackArgument && callback) {
              visit(
                callback,
                {
                  ...context,
                  currentTest: item,
                  testInfoBindings,
                },
                true,
              );
            } else {
              visit(argument, context);
            }
          }
          return;
        }

        if (classification.modifier) {
          const reason = modifierSuppression(
            node,
            sourceFile,
            classification.modifier,
            ts,
          );
          addRuntimeSuppressionEvent(
            node,
            classification.modifier,
            context,
            reason,
          );
          if (reason) {
            if (context.currentTest) {
              if (!context.currentTest.suppressionKind) {
                context.currentTest.suppressionKind = "runtime";
                context.currentTest.suppressionReason = reason;
              }
            }
          }
        }
      } else if (classification?.kind === "runtime") {
        if (classification.uncertain) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1;
          throw new PinInspectionUnavailableError(
            `${file || "Design E2E source"}:${line}: Unable to inspect ambiguous TestInfo alias`,
          );
        }
        const reason = modifierSuppression(
          node,
          sourceFile,
          classification.modifier!,
          ts,
        );
        addRuntimeSuppressionEvent(
          node,
          classification.modifier!,
          context,
          reason,
        );
        if (reason) {
          if (context.currentTest) {
            if (!context.currentTest.suppressionKind) {
              context.currentTest.suppressionKind = "runtime";
              context.currentTest.suppressionReason = reason;
            }
          }
        }
      }

      const callee = unwrapExpression(node.expression, ts);
      const helper =
        !classification &&
        !context.unknownExecutionContext &&
        ts.isIdentifier(callee)
          ? localHelpers.resolve(callee.text, node)
          : undefined;
      if (!classification && !helper && !context.unknownExecutionContext) {
        for (const argument of node.arguments) {
          const callback = resolveContextCallback(argument, context);
          if (
            callback &&
            callbackMayAffectPin(
              callback,
              context,
              new Set(),
              new Set(),
              !context.currentTest,
            )
          ) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(
                node.getStart(sourceFile),
              ).line + 1;
            throw new PinInspectionUnavailableError(
              `${file || "Design E2E source"}:${line}: Unable to inspect callback effects passed to ${stableNodeText(node.expression, sourceFile, printer, ts)}`,
            );
          }
        }
      }
      if (helper) {
        if (!context.activeHelpers.has(helper)) {
          const activeHelpers = new Set(context.activeHelpers);
          activeHelpers.add(helper);
          const testInfoBindings = new Set(context.testInfoBindings);
          const testInfoMaybeBindings = new Set(context.testInfoMaybeBindings);
          const callbackInvocations = new Map(context.callbackInvocations);
          const callbackBindings = new Map(context.callbackBindings);
          helper.parameters.forEach((parameter, index) => {
            if (!ts.isIdentifier(parameter.name)) return;
            const suppliedArgument = node.arguments[index];
            if (suppliedArgument?.kind === ts.SyntaxKind.NullKeyword) return;
            const argument =
              !suppliedArgument ||
              (ts.isIdentifier(suppliedArgument) &&
                suppliedArgument.text === "undefined")
                ? parameter.initializer
                : suppliedArgument;
            if (
              !argument ||
              argument.kind === ts.SyntaxKind.NullKeyword ||
              (ts.isIdentifier(argument) && argument.text === "undefined")
            ) {
              return;
            }
            if (
              ts.isCallExpression(argument) &&
              aliases.resolve(argument.expression).join(".") === "test.info"
            ) {
              testInfoBindings.add(parameter.name);
              return;
            }
            if (ts.isIdentifier(argument)) {
              const status = testInfoAliasResolver.isTestInfo(
                argument,
                context.testInfoBindings,
                context.testInfoMaybeBindings,
              );
              if (status === "known") testInfoBindings.add(parameter.name);
              if (status === "ambiguous")
                testInfoMaybeBindings.add(parameter.name);
            }

            const usage = helperCallbackUsage(helper, index, ts);
            const callback = resolveContextCallback(argument, context);
            if (usage.kind === "unused") {
              if (callback) resolvedCallbacks.add(callback);
              return;
            }
            if (usage.kind === "invoked") {
              if (!callback) {
                const line =
                  sourceFile.getLineAndCharacterOfPosition(
                    node.getStart(sourceFile),
                  ).line + 1;
                throw new PinInspectionUnavailableError(
                  `${file || "Design E2E source"}:${line}: Unable to inspect local helper callback body`,
                );
              }
              resolvedCallbacks.add(callback);
              const binding = testInfoAliasResolver.bindingNode(parameter.name);
              if (binding) callbackBindings.set(binding, callback);
              for (const callSite of usage.callSites)
                callbackInvocations.set(callSite, callback);
            } else if (usage.kind === "unknown") {
              if (
                (callback && callbackMayAffectPin(callback, context)) ||
                (!callback && hasDirectFunctionParameterType(parameter, ts))
              ) {
                const line =
                  sourceFile.getLineAndCharacterOfPosition(
                    node.getStart(sourceFile),
                  ).line + 1;
                throw new PinInspectionUnavailableError(
                  `${file || "Design E2E source"}:${line}: Unable to inspect local helper callback reachability`,
                );
              }
              if (callback) {
                resolvedCallbacks.add(callback);
                const binding = testInfoAliasResolver.bindingNode(
                  parameter.name,
                );
                if (binding) callbackBindings.set(binding, callback);
              }
            } else if (callback) {
              resolvedCallbacks.add(callback);
              const binding = testInfoAliasResolver.bindingNode(parameter.name);
              if (binding) callbackBindings.set(binding, callback);
            }
          });
          visit(
            helper,
            {
              ...context,
              activeHelpers,
              testInfoBindings,
              testInfoMaybeBindings,
              callbackInvocations,
              callbackBindings,
            },
            true,
          );
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, context));
  };
  visit(sourceFile, {
    suiteSuppressions: [],
    testInfoBindings: new Set(),
    testInfoMaybeBindings: new Set(),
    callbackInvocations: new Map(),
    callbackBindings: new Map(),
    suiteRuntimeScopes: [],
    suiteRuntimeReasons: [],
    unknownExecutionContext: false,
    unknownCallbackIdentities: [],
    conditions: [],
    insideSingletonLiteralForEach: false,
    literalForOfBindingGroups: [],
    activeHelpers: new Set(),
  });

  for (const item of registrations) {
    item.suppressionEvents.push(
      ...item.suiteRuntimeScopes.flat(),
      ...fileSuppressions,
      ...focusEvents,
    );
    item.suppressionFingerprint = suppressionFingerprint(
      item.suppressionEvents,
    );
    const runtimeSuiteSuppression = item.suiteRuntimeReasons.flat().at(0);
    if (runtimeSuiteSuppression && !item.suppressionKind) {
      item.suppressionKind = "suite";
      item.suppressionReason = runtimeSuiteSuppression;
    }
    if (fileSuppressionReasons.length > 0 && !item.suppressionKind) {
      item.suppressionKind = "file";
      item.suppressionReason = fileSuppressionReasons[0];
    }
    if (hasFocus && !item.suppressionKind) {
      item.suppressionKind = "focus";
      item.suppressionReason =
        "a test.only declaration can focus this file away";
    }
    if (
      item.dynamic &&
      item.suppressionKind &&
      !item.dynamicTitleFromLiteralForOf
    ) {
      throw new PinInspectionUnavailableError(
        `${file || "Design E2E source"}:${item.line}: Unable to inspect a dynamic title on a suppressed test registration`,
      );
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
    ...(item.suppressionFingerprint === undefined
      ? {}
      : { suppressionFingerprint: item.suppressionFingerprint }),
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
    if (match.suppressionReason?.startsWith("Unable to inspect")) {
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

type DesignE2ERegressionPinIdentity = {
  readonly file: string;
  readonly title: string;
};

export type DesignE2ERegressionPinException =
  | {
      readonly action: "remove";
      readonly from: DesignE2ERegressionPinIdentity;
      readonly reason: string;
      readonly evidence: string;
    }
  | {
      readonly action: "rename";
      readonly from: DesignE2ERegressionPinIdentity;
      readonly to: DesignE2ERegressionPinIdentity;
      readonly reason: string;
      readonly evidence: string;
    }
  | {
      readonly action: "lane-move";
      readonly from: DesignE2ERegressionPinIdentity & {
        readonly shard: string;
      };
      readonly to: DesignE2ERegressionPinIdentity & { readonly shard: string };
      readonly reason: string;
      readonly evidence: string;
      readonly owner: string;
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
    const headPin = headByIdentity.get(identity);
    if (headPin) {
      if (headPin.shard === pin.shard) continue;
      const laneMoveIndex = exceptions.findIndex(
        (exception, index) =>
          !historicalIndexes.has(index) &&
          exception.action === "lane-move" &&
          pinIdentity(exception.from) === identity &&
          exception.from.shard === pin.shard &&
          pinIdentity(exception.to) === identity &&
          exception.to.shard === headPin.shard,
      );
      if (laneMoveIndex >= 0) {
        used.add(laneMoveIndex);
        continue;
      }
      violations.push(
        `protected Design E2E pin changed shards without an explicit lane-move receipt: ${pin.file} / ${pin.title} (${pin.shard} -> ${headPin.shard})`,
      );
      continue;
    }
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
      !["remove", "rename", "lane-move"].includes(exception.action) ||
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
          !exception.to.title.trim())) ||
      (exception.action === "lane-move" &&
        (!exception.to ||
          typeof exception.to.file !== "string" ||
          !exception.to.file.trim() ||
          typeof exception.to.title !== "string" ||
          !exception.to.title.trim() ||
          typeof exception.from.shard !== "string" ||
          !exception.from.shard.trim() ||
          typeof exception.to.shard !== "string" ||
          !exception.to.shard.trim() ||
          typeof exception.owner !== "string" ||
          !exception.owner.trim()))
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
    if (exception.action === "lane-move") {
      const shardNames = new Set<string>(DESIGN_E2E_REGRESSION_SHARDS);
      const sourcePin = baseByIdentity.get(pinIdentity(exception.from));
      const destinationPin = headByIdentity.get(pinIdentity(exception.to));
      if (
        !sourcePin ||
        !destinationPin ||
        pinIdentity(exception.to) !== pinIdentity(exception.from) ||
        sourcePin.shard !== exception.from.shard ||
        destinationPin.shard !== exception.to.shard ||
        !shardNames.has(exception.from.shard) ||
        !shardNames.has(exception.to.shard) ||
        exception.from.shard === exception.to.shard
      ) {
        violations.push(
          `Design E2E pin lane-move must map the same pin from an existing shard to a different head shard: ${exception.from.file} / ${exception.from.title}`,
        );
        continue;
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
    if (exception.action === "rename") {
      const sourcePin = baseByIdentity.get(pinIdentity(exception.from));
      const destinationPin = headByIdentity.get(pinIdentity(exception.to));
      if (
        sourcePin &&
        destinationPin &&
        sourcePin.shard !== destinationPin.shard
      ) {
        violations.push(
          `Design E2E pin rename cannot also change shards: ${exception.from.file} / ${exception.from.title}`,
        );
        continue;
      }
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
