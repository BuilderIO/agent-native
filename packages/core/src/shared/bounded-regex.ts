export const MAX_USER_REGEX_LENGTH = 512;

export const MAX_USER_REGEX_INPUT_LENGTH = 4096;

const MAX_USER_REGEX_REPEAT = MAX_USER_REGEX_INPUT_LENGTH;

const MAX_GROUP_DEPTH = 12;

const MATCHING_FLAGS = ["i", "s", "u", "v"];

const BASE_PROBE_CHARS = [
  "a",
  "Z",
  "5",
  "0",
  " ",
  "\t",
  "\n",
  "_",
  "-",
  "'",
  ".",
  "@",
  "/",
  "#",
  "!",
];

const NON_LITERAL_ESCAPES = new Set("dDwWsSbBnrtfvxucpPk0123456789".split(""));

function collectProbeChars(source: string): string[] {
  const chars = new Set(BASE_PROBE_CHARS);
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next && !NON_LITERAL_ESCAPES.has(next)) chars.add(next);
      i += 1;
      continue;
    }
    if ("()[]{}|^$.*+?".includes(ch)) continue;
    chars.add(ch);
  }
  return [...chars];
}

type AtomKind =
  | "group"
  | "class"
  | "literal"
  | "escape"
  | "dot"
  | "anchor"
  | "backref";

interface RegexAtom {
  kind: AtomKind;
  source: string;
  branches?: RegexAtom[][];
  zeroWidth?: boolean;
  min: number;
  max: number;
}

export type RegexSafetyVerdict =
  | { safe: true }
  | { safe: false; reason: string };

interface ParseState {
  source: string;
  index: number;
  depth: number;
  bailed: boolean;
}

function parseQuantifier(state: ParseState): { min: number; max: number } {
  const { source } = state;
  const ch = source[state.index];
  let min = 1;
  let max = 1;
  if (ch === "*") {
    state.index += 1;
    min = 0;
    max = Number.POSITIVE_INFINITY;
  } else if (ch === "+") {
    state.index += 1;
    min = 1;
    max = Number.POSITIVE_INFINITY;
  } else if (ch === "?") {
    state.index += 1;
    min = 0;
    max = 1;
  } else if (ch === "{") {
    const close = source.indexOf("}", state.index);
    const body = close === -1 ? "" : source.slice(state.index + 1, close);
    const match = /^(\d+)(,(\d*)?)?$/.exec(body);
    if (close !== -1 && match) {
      state.index = close + 1;
      min = Number(match[1]);
      max = match[2]
        ? match[3]
          ? Number(match[3])
          : Number.POSITIVE_INFINITY
        : min;
    }
  }
  if (source[state.index] === "?" || source[state.index] === "+") {
    if (max !== 1 || min !== 1) state.index += 1;
  }
  return { min, max };
}

function parseCharClass(state: ParseState): string {
  const start = state.index;
  state.index += 1;
  if (state.source[state.index] === "^") state.index += 1;
  if (state.source[state.index] === "]") state.index += 1;
  while (state.index < state.source.length) {
    const ch = state.source[state.index];
    if (ch === "\\") {
      state.index += 2;
      continue;
    }
    if (ch === "]") {
      state.index += 1;
      return state.source.slice(start, state.index);
    }
    state.index += 1;
  }
  state.bailed = true;
  return state.source.slice(start);
}

function parseSequence(state: ParseState): RegexAtom[] {
  const atoms: RegexAtom[] = [];
  while (state.index < state.source.length && !state.bailed) {
    const ch = state.source[state.index];
    if (ch === "|" || ch === ")") break;

    let kind: AtomKind = "literal";
    let source = "";
    let branches: RegexAtom[][] | undefined;
    let zeroWidth = false;

    if (ch === "(") {
      if (state.depth >= MAX_GROUP_DEPTH) {
        state.bailed = true;
        break;
      }
      const start = state.index;
      state.index += 1;
      let capturing = true;
      if (state.source[state.index] === "?") {
        const marker = state.source.slice(state.index, state.index + 3);
        if (
          marker.startsWith("?:") ||
          marker.startsWith("?=") ||
          marker.startsWith("?!")
        ) {
          state.index += 2;
          capturing = false;
          zeroWidth = !marker.startsWith("?:");
        } else if (marker === "?<=" || marker === "?<!") {
          state.index += 3;
          capturing = false;
          zeroWidth = true;
        } else if (marker.startsWith("?<")) {
          const close = state.source.indexOf(">", state.index);
          if (close === -1) {
            state.bailed = true;
            break;
          }
          state.index = close + 1;
        }
      }
      state.depth += 1;
      branches = parseAlternation(state);
      state.depth -= 1;
      if (state.source[state.index] !== ")") {
        state.bailed = true;
        break;
      }
      state.index += 1;
      kind = "group";
      source = state.source.slice(start, state.index);
      void capturing;
    } else if (ch === "[") {
      source = parseCharClass(state);
      kind = "class";
    } else if (ch === "\\") {
      const next = state.source[state.index + 1];
      if (
        (next === "p" || next === "P") &&
        state.source[state.index + 2] === "{"
      ) {
        const close = state.source.indexOf("}", state.index + 2);
        if (close === -1) {
          state.bailed = true;
          break;
        }
        source = state.source.slice(state.index, close + 1);
        state.index = close + 1;
        kind = "class";
      } else if (next === "k" && state.source[state.index + 2] === "<") {
        const close = state.source.indexOf(">", state.index + 2);
        if (close === -1) {
          state.bailed = true;
          break;
        }
        source = state.source.slice(state.index, close + 1);
        state.index = close + 1;
        kind = "backref";
      } else {
        source = state.source.slice(state.index, state.index + 2);
        state.index += 2;
        kind = /^\\\d$/.test(source) ? "backref" : "escape";
      }
    } else if (ch === ".") {
      state.index += 1;
      source = ".";
      kind = "dot";
    } else if (ch === "^" || ch === "$") {
      state.index += 1;
      source = ch;
      kind = "anchor";
    } else {
      state.index += 1;
      source = ch;
      kind = "literal";
    }

    const { min, max } = parseQuantifier(state);
    atoms.push({ kind, source, branches, zeroWidth, min, max });
  }
  return atoms;
}

function parseAlternation(state: ParseState): RegexAtom[][] {
  const branches: RegexAtom[][] = [parseSequence(state)];
  while (state.source[state.index] === "|" && !state.bailed) {
    state.index += 1;
    branches.push(parseSequence(state));
  }
  return branches;
}

function isNullable(atom: RegexAtom): boolean {
  if (atom.kind === "anchor") return true;
  if (atom.min === 0) return true;
  if (atom.kind === "group" && atom.branches) {
    return atom.branches.some((branch) => branch.every(isNullable));
  }
  return false;
}

function isVariableLength(atom: RegexAtom): boolean {
  if (atom.max > atom.min) return true;
  if (atom.kind !== "group") return false;
  const branches = atom.branches ?? [];
  if (branches.some((branch) => branch.some(isVariableLength))) return true;
  const lengths = new Set(branches.map((branch) => consuming(branch).length));
  return lengths.size > 1;
}

function minLength(branch: RegexAtom[]): number {
  let total = 0;
  for (const atom of consuming(branch)) {
    total +=
      atom.kind === "group" && atom.branches?.length
        ? atom.min * Math.min(...atom.branches.map(minLength))
        : atom.min;
  }
  return total;
}

type CharSet = Set<string> | "unknown";

function charSetOf(atom: RegexAtom, ctx: AnalysisContext): CharSet {
  const memoized = ctx.charSets.get(atom);
  if (memoized) return memoized;
  const computed = computeCharSet(atom, ctx);
  ctx.charSets.set(atom, computed);
  return computed;
}

function computeCharSet(atom: RegexAtom, ctx: AnalysisContext): CharSet {
  if (atom.kind === "anchor") return new Set();
  if (atom.kind === "backref") return "unknown";
  if (atom.kind === "group") {
    const set = new Set<string>();
    for (const branch of atom.branches ?? []) {
      const leading = leadingCharSet(branch, ctx);
      if (leading === "unknown") return "unknown";
      for (const ch of leading) set.add(ch);
    }
    return set;
  }
  let probe: RegExp;
  try {
    probe = new RegExp(`^(?:${atom.source})$`, ctx.flags);
  } catch {
    return "unknown";
  }
  const set = new Set<string>();
  for (const ch of ctx.probeChars) {
    if (probe.test(ch)) set.add(ch);
  }
  return set.size === 0 ? "unknown" : set;
}

function leadingCharSet(branch: RegexAtom[], ctx: AnalysisContext): CharSet {
  const set = new Set<string>();
  for (const atom of branch) {
    const atomSet = charSetOf(atom, ctx);
    if (atomSet === "unknown") return "unknown";
    for (const ch of atomSet) set.add(ch);
    if (!isNullable(atom)) break;
  }
  return set;
}

function overlaps(a: CharSet, b: CharSet): boolean {
  if (a === "unknown" || b === "unknown") return true;
  for (const ch of a) if (b.has(ch)) return true;
  return false;
}

interface AnalysisContext {
  flags: string;
  charSets: Map<RegexAtom, CharSet>;
  probeChars: readonly string[];
}

/**
 * Atoms that actually consume input. Anchors and lookarounds match a position
 * rather than text, so they cannot compete with a neighbour for characters —
 * counting them makes the standard password rule
 * `(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$` read as three chained repetitions when
 * it is linear.
 */
function consuming(branch: RegexAtom[]): RegexAtom[] {
  return branch.filter((atom) => atom.kind !== "anchor" && !atom.zeroWidth);
}

function maxIterationLength(branch: RegexAtom[]): number {
  let total = 0;
  for (const atom of consuming(branch)) {
    if (atom.max === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    const body =
      atom.kind === "group" && atom.branches?.length
        ? Math.max(...atom.branches.map(maxIterationLength))
        : 1;
    if (body === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    total += atom.max * body;
  }
  return total;
}

function describe(atom: RegexAtom): string {
  const quantifier =
    atom.max === Number.POSITIVE_INFINITY
      ? atom.min === 0
        ? "*"
        : atom.min === 1
          ? "+"
          : `{${atom.min},}`
      : atom.min === 0 && atom.max === 1
        ? "?"
        : "";
  return `${atom.source}${quantifier}`;
}

function sameLanguage(
  a: RegexAtom[],
  b: RegexAtom[],
  ctx: AnalysisContext,
): boolean {
  const left = consuming(a);
  const right = consuming(b);
  if (left.length === 0 || left.length !== right.length) return false;
  return left.every((atom, index) => {
    const other = right[index];
    if (atom.min !== other.min || atom.max !== other.max) return false;
    const setA = charSetOf(atom, ctx);
    const setB = charSetOf(other, ctx);
    if (setA === "unknown" || setB === "unknown") return true;
    return setA.size === setB.size && [...setA].every((ch) => setB.has(ch));
  });
}

function analyzeRepeatedGroup(
  atom: RegexAtom,
  ctx: AnalysisContext,
): string | null {
  const branches = atom.branches ?? [];

  for (const branch of branches) {
    const atoms = consuming(branch);
    if (atoms.length === 0) continue;
    if (maxIterationLength(branch) < 2) continue;

    if (atoms.length > 1) {
      const nullable = atoms.find(isNullable);
      const variable = atoms.find(
        (candidate) => isVariableLength(candidate) && candidate !== nullable,
      );
      if (nullable && variable) {
        return `repeated group \`${describe(atom)}\` contains both an optional part (\`${describe(nullable)}\`) and a variable-length part (\`${describe(variable)}\`), so the same text can be split in exponentially many ways`;
      }
    }

    for (let i = 0; i + 1 < atoms.length; i += 1) {
      const left = atoms[i];
      const right = atoms[i + 1];
      if (!isVariableLength(left) && !isVariableLength(right)) continue;
      if (overlaps(charSetOf(left, ctx), charSetOf(right, ctx))) {
        return `repeated group \`${describe(atom)}\` has adjacent repetitions (\`${describe(left)}\` and \`${describe(right)}\`) that match the same characters`;
      }
    }

    const first = atoms[0];
    const last = atoms[atoms.length - 1];
    if (
      (isVariableLength(first) || isVariableLength(last)) &&
      overlaps(charSetOf(last, ctx), charSetOf(first, ctx))
    ) {
      return `repeated group \`${describe(atom)}\` can match the same characters at the start and end of each repetition`;
    }

    if (atoms.every(isNullable)) {
      return `repeated group \`${describe(atom)}\` can match an empty string`;
    }
  }

  for (let i = 0; i < branches.length; i += 1) {
    for (let j = i + 1; j < branches.length; j += 1) {
      const a = branches[i];
      const b = branches[j];
      if (!overlaps(leadingCharSet(a, ctx), leadingCharSet(b, ctx))) continue;
      const ambiguous =
        minLength(a) !== minLength(b) ||
        a.some(isVariableLength) ||
        b.some(isVariableLength) ||
        (consuming(a).length === 1 && consuming(b).length === 1) ||
        sameLanguage(a, b, ctx);
      if (ambiguous) {
        return `repeated group \`${describe(atom)}\` has alternatives that can match the same text in more than one way`;
      }
    }
  }

  return null;
}

function analyzeAdjacentRun(
  branch: RegexAtom[],
  ctx: AnalysisContext,
  rejectQuadratic: boolean,
): string | null {
  const atoms = consuming(branch);
  const minimumRun = rejectQuadratic ? 2 : 3;
  let run: RegexAtom[] = [];
  for (const atom of atoms) {
    const previous = run[run.length - 1];
    const continues =
      isVariableLength(atom) &&
      (run.length === 0 ||
        overlaps(charSetOf(previous, ctx), charSetOf(atom, ctx)));
    run = continues ? [...run, atom] : isVariableLength(atom) ? [atom] : [];
    if (run.length >= minimumRun) {
      return rejectQuadratic
        ? `\`${run.map(describe).join("")}\` chains adjacent repetitions over the same characters, which backtracks quadratically on uncapped input`
        : `\`${run.map(describe).join("")}\` chains three repetitions over the same characters, which backtracks cubically`;
    }
  }
  return null;
}

function analyzeNullableSeparatedRun(
  branch: RegexAtom[],
  ctx: AnalysisContext,
  rejectQuadratic: boolean,
): string | null {
  if (!rejectQuadratic) return null;
  const atoms = consuming(branch);
  for (let i = 0; i < atoms.length; i += 1) {
    const left = atoms[i];
    if (!isVariableLength(left)) continue;
    let betweenNullable = true;
    for (let j = i + 1; j < atoms.length; j += 1) {
      const right = atoms[j];
      if (
        betweenNullable &&
        isVariableLength(right) &&
        overlaps(charSetOf(left, ctx), charSetOf(right, ctx))
      ) {
        return `variable-length repetitions \`${describe(left)}\` and \`${describe(right)}\` can compete across a nullable separator on uncapped input`;
      }
      betweenNullable = betweenNullable && isNullable(right);
      if (!betweenNullable) break;
    }
  }
  return null;
}

function walk(
  branches: RegexAtom[][],
  ctx: AnalysisContext,
  rejectQuadratic: boolean,
): string | null {
  if (rejectQuadratic && containsVariableLengthLookaround(branches)) {
    return "variable-length lookarounds cannot be bounded safely on uncapped input";
  }
  if (rejectQuadratic && containsBackreference(branches)) {
    return "backreferences cannot be bounded safely on uncapped input";
  }
  for (const branch of branches) {
    const chained = analyzeAdjacentRun(branch, ctx, rejectQuadratic);
    if (chained) return chained;
    const nullableSeparated = analyzeNullableSeparatedRun(
      branch,
      ctx,
      rejectQuadratic,
    );
    if (nullableSeparated) return nullableSeparated;
    for (const atom of branch) {
      if (atom.kind !== "group") continue;
      if (atom.max > 1) {
        const reason = analyzeRepeatedGroup(atom, ctx);
        if (reason) return reason;
      }
      const nested = walk(atom.branches ?? [], ctx, rejectQuadratic);
      if (nested) return nested;
    }
  }
  return null;
}

function findOversizedQuantifier(branches: RegexAtom[][]): string | null {
  for (const branch of branches) {
    for (const atom of branch) {
      if (
        atom.min > MAX_USER_REGEX_REPEAT ||
        (Number.isFinite(atom.max) && atom.max > MAX_USER_REGEX_REPEAT)
      ) {
        return `finite repetition count for \`${atom.source}\` exceeds ${MAX_USER_REGEX_REPEAT}`;
      }
      if (atom.kind === "group") {
        const nested = findOversizedQuantifier(atom.branches ?? []);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function containsBackreference(branches: RegexAtom[][]): boolean {
  return branches.some((branch) =>
    branch.some(
      (atom) =>
        atom.kind === "backref" ||
        (atom.kind === "group" && containsBackreference(atom.branches ?? [])),
    ),
  );
}

function containsVariableLengthLookaround(branches: RegexAtom[][]): boolean {
  return branches.some((branch) =>
    branch.some(
      (atom) =>
        (atom.kind === "group" &&
          atom.zeroWidth === true &&
          isVariableLength(atom)) ||
        (atom.kind === "group" &&
          containsVariableLengthLookaround(atom.branches ?? [])),
    ),
  );
}

export function analyzeRegexSource(
  source: string,
  flags = "",
  options: { inputBounded?: boolean } = {},
): RegexSafetyVerdict {
  if (source.length > MAX_USER_REGEX_LENGTH) {
    return {
      safe: false,
      reason: `pattern is ${source.length} characters; the limit is ${MAX_USER_REGEX_LENGTH}`,
    };
  }
  if (
    options.inputBounded === false &&
    flags.includes("v") &&
    source.includes("\\q{")
  ) {
    return {
      safe: false,
      reason:
        "unicode-set string alternatives cannot be bounded safely on uncapped input",
    };
  }
  const state: ParseState = { source, index: 0, depth: 0, bailed: false };
  const branches = parseAlternation(state);
  if (state.bailed || state.index < source.length) {
    return {
      safe: false,
      reason:
        "pattern uses constructs this validator cannot analyze for catastrophic backtracking",
    };
  }
  const oversizedQuantifier = findOversizedQuantifier(branches);
  if (oversizedQuantifier) {
    return { safe: false, reason: oversizedQuantifier };
  }
  const probeFlags = MATCHING_FLAGS.filter((flag) => flags.includes(flag)).join(
    "",
  );
  const reason = walk(
    branches,
    {
      flags: probeFlags,
      probeChars: collectProbeChars(source),
      charSets: new Map(),
    },
    options.inputBounded === false,
  );
  return reason ? { safe: false, reason } : { safe: true };
}

export type UserRegexCompileResult =
  | { status: "ok"; regex: RegExp }
  | { status: "too-long"; message: string }
  | { status: "invalid-syntax"; message: string }
  | { status: "unsafe"; message: string };

export function compileUserRegex(
  source: string,
  options: { flags?: string } = {},
): UserRegexCompileResult {
  if (source.length > MAX_USER_REGEX_LENGTH) {
    return {
      status: "too-long",
      message: `pattern is ${source.length} characters; the limit is ${MAX_USER_REGEX_LENGTH}`,
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(source, options.flags);
  } catch (error) {
    return {
      status: "invalid-syntax",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const verdict = analyzeRegexSource(source, options.flags);
  if (!verdict.safe) {
    return { status: "unsafe", message: verdict.reason };
  }

  return { status: "ok", regex };
}

export type UserRegexTestResult =
  | { status: "match" }
  | { status: "no-match" }
  | { status: "unevaluated"; reason: string };

export function testUserRegex(
  source: string,
  value: string,
  options: { flags?: string } = {},
): UserRegexTestResult {
  const compiled = compileUserRegex(source, options);
  if (compiled.status !== "ok") {
    return { status: "unevaluated", reason: compiled.message };
  }
  if (value.length > MAX_USER_REGEX_INPUT_LENGTH) {
    return {
      status: "unevaluated",
      reason: `value is ${value.length} characters; the limit for pattern checks is ${MAX_USER_REGEX_INPUT_LENGTH}`,
    };
  }
  try {
    return compiled.regex.test(value)
      ? { status: "match" }
      : { status: "no-match" };
  } catch (error) {
    return {
      status: "unevaluated",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
