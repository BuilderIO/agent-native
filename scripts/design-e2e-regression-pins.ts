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

export const DESIGN_E2E_REGRESSION_PINS = [
  {
    shard: "inspector-1a",
    file: "canvas-invariants.spec.ts",
    title: "a child of an auto-layout parent still reports real geometry",
  },
  {
    shard: "inspector-1a",
    file: "canvas-invariants.spec.ts",
    title: "deleting a layer removes it from the document",
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
    title: "X/Y match the element's real position, not 0,0",
  },
  {
    shard: "inspector-2",
    file: "canvas-invariants.spec.ts",
    title: "setting X moves the element by exactly that amount",
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
    file: "canvas-invariants.spec.ts",
    title:
      "Escape on a rect drawn inside a frame clears, and never lands on the screen",
  },
  {
    shard: "inspector-3a",
    file: "inspector-styles.spec.ts",
    title: "resizing a selected element emits a visual-style-change payload",
  },
  {
    shard: "inspector-3a",
    file: "inspector-styles.spec.ts",
    title: "can capture a screenshot of inspector coverage via CDP",
  },
  {
    shard: "inspector-3b",
    file: "canvas-invariants.spec.ts",
    title: "basic authoring raises no uncaught page errors",
  },
  {
    shard: "inspector-3b",
    file: "inspector-styles.spec.ts",
    title:
      "pointercancel restores a scrubbed value without adding a history step",
  },
  {
    shard: "inspector-4a",
    file: "canvas-invariants.spec.ts",
    title: "setting Y moves the element by exactly that amount",
  },
  {
    shard: "inspector-4a",
    file: "inspector-styles.spec.ts",
    title: "search selects Lato Medium and keeps custom font names offline",
  },
  {
    shard: "inspector-4a",
    file: "inspector-styles.spec.ts",
    title:
      "numeric input applies arithmetic expressions and starts an Option scrub drag",
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
    shard: "position-1a",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "clipboard SVG File paste in the parent editor stays editable after reload",
  },
  {
    shard: "position-1a",
    file: "pasted-svg-image-inspector.spec.ts",
    title: "rejected SVG HTML is consumed instead of inserted as native markup",
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
] as const satisfies readonly DesignE2ERegressionPin[];

export function findDesignE2ETestLine(source: string, title: string): number {
  const sourceFile = ts.createSourceFile(
    "design-e2e-regression.spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    throw new Error(`Unable to parse Design E2E spec while resolving ${title}`);
  }

  const lines: number[] = [];
  const testCallNames = new Set([
    "test",
    "test.fail",
    "test.fixme",
    "test.only",
    "test.skip",
  ]);
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      testCallNames.has(node.expression.getText(sourceFile)) &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      node.arguments[0]!.text === title
    ) {
      lines.push(
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (lines.length !== 1) {
    throw new Error(
      `Design E2E pin title ${JSON.stringify(title)} must match exactly one test title; found ${lines.length}`,
    );
  }
  return lines[0]!;
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
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli();
}
