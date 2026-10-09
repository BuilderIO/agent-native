import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeSourceString(value: string, quote: string): string {
  let escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll(quote, `\\${quote}`)
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
  if (quote === "`") escaped = escaped.replaceAll("${", "\\${");
  return `${quote}${escaped}${quote}`;
}

function isLikelyRegexStart(source: string, index: number): boolean {
  const prefix = source.slice(0, index).trimEnd();
  if (prefix.endsWith("=>")) return true;
  const previous = prefix.at(-1);
  if (previous === "!") {
    const beforeBang = prefix.slice(0, -1).trimEnd().at(-1);
    return beforeBang === undefined || !/[A-Za-z0-9_$)\]}]/.test(beforeBang);
  }
  if (previous === undefined) return true;
  if (
    /\b(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(
      prefix,
    )
  ) {
    return true;
  }
  return [
    "(",
    "[",
    "{",
    ",",
    ":",
    ";",
    "=",
    "?",
    "&",
    "|",
    "+",
    "-",
    "*",
    "%",
    "^",
    "~",
    "<",
    ">",
  ].includes(previous);
}

function skipRegexLiteral(source: string, start: number): number {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "\n" || character === "\r") return start + 1;
    if (character === "[") inCharacterClass = true;
    else if (character === "]") inCharacterClass = false;
    else if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[a-z]/i.test(source[index] ?? "")) index += 1;
      return index;
    }
    index += 1;
  }
  return start + 1;
}

function maskNonCode(source: string): string {
  const masked = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" =
    "code";
  const templates: { expressionDepth: number | null }[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (state === "code") {
      const template = templates.at(-1);
      if (template?.expressionDepth !== null && template !== undefined) {
        if (character === "{") template.expressionDepth += 1;
        else if (character === "}") {
          template.expressionDepth -= 1;
          if (template.expressionDepth === 0) {
            state = "template";
            continue;
          }
        }
      }
      if (character === "/" && next === "/") {
        masked[index] = " ";
        masked[index + 1] = " ";
        index += 1;
        state = "line";
      } else if (character === "/" && next === "*") {
        masked[index] = " ";
        masked[index + 1] = " ";
        index += 1;
        state = "block";
      } else if (character === "'") {
        masked[index] = " ";
        state = "single";
      } else if (character === '"') {
        masked[index] = " ";
        state = "double";
      } else if (character === "`") {
        masked[index] = " ";
        templates.push({ expressionDepth: null });
        state = "template";
      } else if (character === "/" && isLikelyRegexStart(source, index)) {
        const end = skipRegexLiteral(source, index);
        if (end > index + 1) {
          for (let cursor = index; cursor < end; cursor += 1) {
            if (source[cursor] !== "\n" && source[cursor] !== "\r") {
              masked[cursor] = " ";
            }
          }
          index = end - 1;
        }
      }
      continue;
    }

    if (state === "template") {
      if (character === "\\") {
        masked[index] = " ";
        if (next !== undefined && next !== "\n" && next !== "\r") {
          masked[index + 1] = " ";
          index += 1;
        }
      } else if (character === "`") {
        masked[index] = " ";
        templates.pop();
        state = "code";
      } else if (character === "$" && next === "{") {
        masked[index] = " ";
        templates.at(-1)!.expressionDepth = 1;
        state = "code";
        index += 1;
      } else if (character !== "\n" && character !== "\r") {
        masked[index] = " ";
      }
      continue;
    }

    if (state === "line") {
      if (character === "\n") state = "code";
      else masked[index] = " ";
      continue;
    }
    if (state === "block") {
      if (character === "*" && next === "/") {
        masked[index] = " ";
        masked[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (character !== "\n") {
        masked[index] = " ";
      }
      continue;
    }

    const closingQuote = state === "single" ? "'" : '"';
    if (character === "\\") {
      masked[index] = " ";
      if (next !== undefined && next !== "\n" && next !== "\r") {
        masked[index + 1] = " ";
        index += 1;
      }
    } else if (character === closingQuote) {
      masked[index] = " ";
      state = "code";
    } else if (character !== "\n" && character !== "\r") {
      masked[index] = " ";
    }
  }
  return masked.join("");
}

type SourceRange = { readonly start: number; readonly end: number };

type RegistrationCall = {
  readonly start: number;
  readonly open: number;
  readonly close: number;
  readonly modifier?: string;
};

class DisabledRegressionPinError extends Error {}
class PinInspectionUnavailableError extends Error {}

function findDelimiterPairs(code: string): Map<number, number> {
  const closingToOpening = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);
  const opening = new Set(["(", "[", "{"]);
  const stack: { readonly character: string; readonly index: number }[] = [];
  const pairs = new Map<number, number>();

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index]!;
    if (opening.has(character)) {
      stack.push({ character, index });
      continue;
    }

    const expectedOpening = closingToOpening.get(character);
    if (expectedOpening === undefined) continue;

    const current = stack.pop();
    if (current?.character !== expectedOpening) {
      throw new PinInspectionUnavailableError(
        `Unable to inspect Design E2E source near character ${index}: unbalanced delimiters`,
      );
    }
    pairs.set(current.index, index);
  }

  if (stack.length > 0) {
    throw new PinInspectionUnavailableError(
      `Unable to inspect Design E2E source near character ${stack.at(-1)!.index}: unclosed delimiter`,
    );
  }
  return pairs;
}

function findRegistrationCalls(
  code: string,
  pairs: Map<number, number>,
  pattern: RegExp,
): RegistrationCall[] {
  const calls: RegistrationCall[] = [];
  for (const match of code.matchAll(pattern)) {
    const start = match.index;
    const open = start + match[0].lastIndexOf("(");
    const close = pairs.get(open);
    if (close === undefined) {
      throw new PinInspectionUnavailableError(
        `Unable to inspect Design E2E registration near character ${start}: call has no closing parenthesis`,
      );
    }
    calls.push({
      start,
      open,
      close,
      ...(match.groups?.modifier ? { modifier: match.groups.modifier } : {}),
    });
  }
  return calls;
}

function findCallArguments(
  code: string,
  call: RegistrationCall,
  pairs: Map<number, number>,
): SourceRange[] {
  const arguments_: SourceRange[] = [];
  let argumentStart = call.open + 1;
  for (let index = argumentStart; index < call.close; index += 1) {
    if ("([{".includes(code[index]!)) {
      const nestedClose = pairs.get(index);
      if (nestedClose === undefined || nestedClose >= call.close) {
        throw new PinInspectionUnavailableError(
          `Unable to inspect Design E2E call arguments near character ${index}`,
        );
      }
      index = nestedClose;
    } else if (code[index] === ",") {
      arguments_.push({ start: argumentStart, end: index });
      argumentStart = index + 1;
    }
  }
  if (argumentStart < call.close || arguments_.length > 0) {
    arguments_.push({ start: argumentStart, end: call.close });
  }
  return arguments_;
}

function skipWhitespace(code: string, index: number, end: number): number {
  while (index < end && /\s/.test(code[index]!)) index += 1;
  return index;
}

function isFunctionKeyword(code: string, index: number): boolean {
  return (
    code.startsWith("function", index) &&
    !/[\w$]/.test(code[index - 1] ?? "") &&
    !/[\w$]/.test(code[index + "function".length] ?? "")
  );
}

function findInlineCallbackBody(
  code: string,
  argument: SourceRange | undefined,
  pairs: Map<number, number>,
): SourceRange | undefined {
  if (!argument) return undefined;

  let start = skipWhitespace(code, argument.start, argument.end);
  let end = argument.end;
  while (code[start] === "(") {
    const wrapperClose = pairs.get(start);
    let last = end - 1;
    while (last >= start && /\s/.test(code[last]!)) last -= 1;
    if (wrapperClose !== last) break;
    start = skipWhitespace(code, start + 1, wrapperClose);
    end = wrapperClose;
  }

  let inFunctionExpression = false;
  for (let index = start; index < end; index += 1) {
    if (isFunctionKeyword(code, index)) {
      inFunctionExpression = true;
      index += "function".length - 1;
      continue;
    }
    if (code.startsWith("=>", index)) {
      const bodyStart = skipWhitespace(code, index + 2, end);
      if (code[bodyStart] === "{") {
        const bodyClose = pairs.get(bodyStart);
        if (bodyClose === undefined || bodyClose >= end) {
          throw new PinInspectionUnavailableError(
            `Unable to inspect Design E2E callback near character ${bodyStart}`,
          );
        }
        return { start: bodyStart + 1, end: bodyClose };
      }
      return { start: bodyStart, end };
    }
    if ("([{".includes(code[index]!)) {
      const nestedClose = pairs.get(index);
      if (nestedClose === undefined || nestedClose >= end) {
        throw new PinInspectionUnavailableError(
          `Unable to inspect Design E2E callback near character ${index}`,
        );
      }
      if (code[index] === "{" && inFunctionExpression) {
        return { start: index + 1, end: nestedClose };
      }
      index = nestedClose;
    }
  }
  return undefined;
}

function contains(range: SourceRange, offset: number): boolean {
  return range.start <= offset && offset < range.end;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function rejectDisabledPin(title: string, reason: string): never {
  throw new DisabledRegressionPinError(
    `Design E2E pin title ${JSON.stringify(title)} must run without test modifiers or suite/file suppression: ${reason}`,
  );
}

function inspectPinSuppressions(
  source: string,
  code: string,
  title: string,
  testOffset: number,
): void {
  const pairs = findDelimiterPairs(code);
  const testCalls = findRegistrationCalls(
    code,
    pairs,
    /(?<![\w$.])test[\t\r\n ]*(?:(?:\?\.|[\t\r\n ]*\.)[\t\r\n ]*(?<modifier>fail|fixme|only|skip))?[\t\r\n ]*\(/g,
  );
  const testInfoModifierCalls = findRegistrationCalls(
    code,
    pairs,
    /(?<![\w$.])testInfo[\t\r\n ]*\.[\t\r\n ]*(?<modifier>fail|fixme|skip)[\t\r\n ]*\(/g,
  );
  const testInfoAccessorModifierCalls = findRegistrationCalls(
    code,
    pairs,
    /(?<![\w$.])test[\t\r\n ]*\.[\t\r\n ]*info[\t\r\n ]*\([\t\r\n ]*\)[\t\r\n ]*\.[\t\r\n ]*(?<modifier>fail|fixme|skip)[\t\r\n ]*\(/g,
  );
  const describeCalls = findRegistrationCalls(
    code,
    pairs,
    /(?<![\w$.])test[\t\r\n ]*\.[\t\r\n ]*describe(?:[\t\r\n ]*\.[\t\r\n ]*(?<modifier>fail|fixme|only|skip))?[\t\r\n ]*\(/g,
  );

  for (const call of testCalls) {
    if (call.modifier === "only" && call.start !== testOffset) {
      rejectDisabledPin(
        title,
        "another test.only declaration can focus this file away",
      );
    }
  }
  for (const call of describeCalls) {
    if (call.modifier === "only") {
      rejectDisabledPin(
        title,
        "a test.describe.only declaration can focus this file away",
      );
    }
  }

  const suiteBodies: SourceRange[] = [];
  for (const call of describeCalls) {
    const arguments_ = findCallArguments(code, call, pairs);
    const body = findInlineCallbackBody(code, arguments_.at(-1), pairs);
    if (body) suiteBodies.push(body);
    if (["fail", "fixme", "skip"].includes(call.modifier ?? "") && !body) {
      throw new PinInspectionUnavailableError(
        `Unable to inspect modified test.describe callback at line ${lineAt(source, call.start)}`,
      );
    }
    if (
      body &&
      ["fail", "fixme", "skip"].includes(call.modifier ?? "") &&
      contains(body, testOffset)
    ) {
      rejectDisabledPin(
        title,
        `an enclosing test.describe.${call.modifier} can suppress this test`,
      );
    }
  }

  const testBodies: {
    readonly call: RegistrationCall;
    readonly body: SourceRange;
  }[] = [];
  for (const call of testCalls) {
    const arguments_ = findCallArguments(code, call, pairs);
    for (const argument of arguments_.slice(1)) {
      const body = findInlineCallbackBody(code, argument, pairs);
      if (body) testBodies.push({ call, body });
    }
  }
  const pinnedBody = testBodies.find(
    ({ call }) => call.start === testOffset,
  )?.body;

  for (const call of [
    ...testCalls,
    ...testInfoModifierCalls,
    ...testInfoAccessorModifierCalls,
  ]) {
    if (!["fail", "fixme", "skip"].includes(call.modifier ?? "")) {
      continue;
    }
    const arguments_ = findCallArguments(code, call, pairs);
    const firstArgument = arguments_[0];
    const hasCallback = arguments_
      .slice(1)
      .some((argument) => findInlineCallbackBody(code, argument, pairs));
    if (hasCallback) continue;

    const insidePinnedBody = pinnedBody && contains(pinnedBody, call.start);
    const insideAnotherTestBody = testBodies.some(({ body }) =>
      contains(body, call.start),
    );
    if (insideAnotherTestBody && !insidePinnedBody) continue;
    const containingSuites = suiteBodies.filter((body) =>
      contains(body, call.start),
    );
    const innermostSuite = containingSuites.sort(
      (left, right) => right.start - left.start,
    )[0];
    if (innermostSuite && !contains(innermostSuite, testOffset)) continue;

    const condition = firstArgument
      ? code.slice(firstArgument.start, firstArgument.end).trim()
      : "";
    if (condition === "false") continue;
    if (condition !== "" && condition !== "true") {
      throw new PinInspectionUnavailableError(
        `Unable to inspect conditional test.${call.modifier} at line ${lineAt(source, call.start)}`,
      );
    }
    rejectDisabledPin(
      title,
      `a file- or suite-level test.${call.modifier} at line ${lineAt(source, call.start)} can suppress this test`,
    );
  }
}

export function findDesignE2ETestLine(source: string, title: string): number {
  const code = maskNonCode(source);
  const literals = ['"', "'", "`"]
    .map((quote) => escapeRegExp(makeSourceString(title, quote)))
    .join("|");
  const testCall = new RegExp(
    `(?<![\\w$.])test(?:[\\t ]*\\.[\\t ]*(?:fail|fixme|only|skip))?[\\t ]*\\([\\t\\r\\n ]*(?:${literals})(?=[\\t\\r\\n ]*[,\\)])`,
    "g",
  );
  const matches: { readonly offset: number; readonly line: number }[] = [];
  for (const match of source.matchAll(testCall)) {
    const testOffset = match.index + match[0].search(/\S/);
    if (code[testOffset] !== "t") continue;
    if (/^test[\t\r\n ]*\./.test(match[0])) {
      rejectDisabledPin(title, "the pinned test declaration has a modifier");
    }
    matches.push({ offset: testOffset, line: lineAt(source, testOffset) });
  }

  if (matches.length !== 1) {
    throw new Error(
      `Design E2E pin title ${JSON.stringify(title)} must match exactly one test title; found ${matches.length}`,
    );
  }
  const match = matches[0]!;
  inspectPinSuppressions(source, code, title, match.offset);
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
