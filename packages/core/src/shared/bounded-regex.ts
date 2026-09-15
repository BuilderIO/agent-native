/**
 * Bounded evaluation of regular expressions that come from an agent or an end
 * user rather than from source.
 *
 * `new RegExp(source).test(value)` is not a bounded operation. A pattern an LLM
 * routinely writes for "must be at least two words" — `^([A-Za-z]+\s?)+$` — is
 * 17 characters, compiles cleanly, and backtracks exponentially: matching it
 * against a 26-character non-matching value already costs ~750 ms and doubles
 * with every additional character. Stored on a form field it freezes the
 * respondent's tab and, because the same pattern is re-checked server side on
 * submit, the request handler's event loop with it. Capping the input length
 * does not help; the blowup is reached well inside any sane cap.
 *
 * There is no timeout on `RegExp` in JavaScript, so the bound has to come from
 * refusing to run patterns whose shape permits the blowup. `analyzeRegexSource`
 * is that refusal, and it is deliberately a heuristic: it recognises the
 * ambiguity signatures that cause super-linear backtracking rather than proving
 * their absence. Patterns it clears are still evaluated against a capped input.
 *
 * Callers get a tri-state result. "Did not match" and "was not evaluated" are
 * different answers, and collapsing the second into the first is how an
 * unenforceable rule silently becomes an enforced-looking one.
 */

/** Longest pattern source accepted. Real validation patterns are far shorter. */
export const MAX_USER_REGEX_LENGTH = 512;

/** Longest value fed to a user-authored pattern. */
export const MAX_USER_REGEX_INPUT_LENGTH = 4096;

/** Nesting depth beyond which the analyzer stops trusting its own reading. */
const MAX_GROUP_DEPTH = 12;

/**
 * Representative characters used to approximate "can these two atoms match the
 * same character". A fixed probe alphabet keeps the comparison cheap and lets
 * the engine itself answer the question for each single character.
 */
const PROBE_CHARS = [
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
  /** Atom source with its quantifier stripped. */
  source: string;
  /** Present for groups: the alternation branches of the group body. */
  branches?: RegexAtom[][];
  min: number;
  /** `Number.POSITIVE_INFINITY` for `*`, `+` and `{n,}`. */
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
  // A lazy or possessive marker changes match semantics, not the ambiguity
  // that drives backtracking cost.
  if (source[state.index] === "?" || source[state.index] === "+") {
    if (max !== 1 || min !== 1) state.index += 1;
  }
  return { min, max };
}

function parseCharClass(state: ParseState): string {
  const start = state.index;
  state.index += 1; // consume "["
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
        } else if (marker === "?<=" || marker === "?<!") {
          state.index += 3;
          capturing = false;
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
      source = state.source.slice(state.index, state.index + 2);
      state.index += 2;
      kind = /^\\\d$/.test(source) ? "backref" : "escape";
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
    atoms.push({ kind, source, branches, min, max });
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

function isUnbounded(atom: RegexAtom): boolean {
  return atom.max === Number.POSITIVE_INFINITY;
}

/**
 * Characters this atom can match in a single position. Derived by asking the
 * engine itself, one probe character at a time, so a single-character match can
 * never be the expensive case.
 */
function charSetOf(atom: RegexAtom): Set<string> {
  if (atom.kind === "anchor" || atom.kind === "backref") return new Set();
  if (atom.kind === "group") {
    const set = new Set<string>();
    for (const branch of atom.branches ?? []) {
      for (const ch of leadingCharSet(branch)) set.add(ch);
    }
    return set;
  }
  const set = new Set<string>();
  let probe: RegExp;
  try {
    probe = new RegExp(`^(?:${atom.source})$`);
  } catch {
    return set;
  }
  for (const ch of PROBE_CHARS) {
    if (probe.test(ch)) set.add(ch);
  }
  return set;
}

/** Characters a branch can start with, looking past nullable leading atoms. */
function leadingCharSet(branch: RegexAtom[]): Set<string> {
  const set = new Set<string>();
  for (const atom of branch) {
    for (const ch of charSetOf(atom)) set.add(ch);
    if (!isNullable(atom)) break;
  }
  return set;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const ch of a) if (b.has(ch)) return true;
  return false;
}

/** Atoms that actually consume input — anchors carry no matching cost. */
function consuming(branch: RegexAtom[]): RegexAtom[] {
  return branch.filter((atom) => atom.kind !== "anchor");
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

function analyzeRepeatedGroup(atom: RegexAtom): string | null {
  const branches = atom.branches ?? [];

  for (const branch of branches) {
    const atoms = consuming(branch);
    if (atoms.length === 0) continue;

    // An inner repetition that may match nothing lets the outer repetition
    // split the same input in exponentially many ways.
    if (atoms.length > 1) {
      const nullable = atoms.find(isNullable);
      const unbounded = atoms.find(
        (candidate) => isUnbounded(candidate) && candidate !== nullable,
      );
      if (nullable && unbounded) {
        return `repeated group \`${describe(atom)}\` contains both an optional part (\`${describe(nullable)}\`) and an unbounded repetition (\`${describe(unbounded)}\`), so the same text can be split in exponentially many ways`;
      }
    }

    // Neighbouring repetitions competing for the same characters.
    for (let i = 0; i + 1 < atoms.length; i += 1) {
      const left = atoms[i];
      const right = atoms[i + 1];
      if (!isUnbounded(left) && !isUnbounded(right)) continue;
      if (!isNullable(left) && !isNullable(right) && !isUnbounded(left))
        continue;
      if (overlaps(charSetOf(left), charSetOf(right))) {
        return `repeated group \`${describe(atom)}\` has adjacent repetitions (\`${describe(left)}\` and \`${describe(right)}\`) that match the same characters`;
      }
    }

    // The junction between two iterations of the outer repetition.
    const first = atoms[0];
    const last = atoms[atoms.length - 1];
    if (
      (isUnbounded(first) || isUnbounded(last)) &&
      overlaps(charSetOf(last), charSetOf(first))
    ) {
      return `repeated group \`${describe(atom)}\` can match the same characters at the start and end of each repetition`;
    }

    if (atoms.every(isNullable)) {
      return `repeated group \`${describe(atom)}\` can match an empty string`;
    }
  }

  // Alternatives inside a repetition that accept the same single-atom input.
  for (let i = 0; i < branches.length; i += 1) {
    for (let j = i + 1; j < branches.length; j += 1) {
      const a = consuming(branches[i]);
      const b = consuming(branches[j]);
      if (a.length !== 1 || b.length !== 1) continue;
      if (overlaps(charSetOf(a[0]), charSetOf(b[0]))) {
        return `repeated group \`${describe(atom)}\` has alternatives (\`${describe(a[0])}\` and \`${describe(b[0])}\`) that match the same characters`;
      }
    }
  }

  return null;
}

function walk(branches: RegexAtom[][]): string | null {
  for (const branch of branches) {
    for (const atom of branch) {
      if (atom.kind !== "group") continue;
      if (isUnbounded(atom)) {
        const reason = analyzeRepeatedGroup(atom);
        if (reason) return reason;
      }
      const nested = walk(atom.branches ?? []);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Report whether `source` is shaped like a pattern that can backtrack
 * super-linearly. A `safe: true` verdict means no known blowup signature was
 * found, not that the pattern is provably linear.
 */
export function analyzeRegexSource(source: string): RegexSafetyVerdict {
  const state: ParseState = { source, index: 0, depth: 0, bailed: false };
  const branches = parseAlternation(state);
  if (state.bailed || state.index < source.length) {
    return {
      safe: false,
      reason:
        "pattern uses constructs this validator cannot analyze for catastrophic backtracking",
    };
  }
  const reason = walk(branches);
  return reason ? { safe: false, reason } : { safe: true };
}

export type UserRegexCompileResult =
  | { status: "ok"; regex: RegExp }
  | { status: "too-long"; message: string }
  | { status: "invalid-syntax"; message: string }
  | { status: "unsafe"; message: string };

/**
 * Compile a pattern that came from outside source control, rejecting sources
 * that are over-long, syntactically invalid, or shaped like a ReDoS.
 */
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

  const verdict = analyzeRegexSource(source);
  if (!verdict.safe) {
    return { status: "unsafe", message: verdict.reason };
  }

  return { status: "ok", regex };
}

export type UserRegexTestResult =
  | { status: "match" }
  | { status: "no-match" }
  | { status: "unevaluated"; reason: string };

/**
 * Test `value` against a user-authored pattern within a bounded budget.
 *
 * `unevaluated` is a distinct outcome on purpose: the caller has to decide what
 * an unenforceable rule means for its surface, and cannot accidentally read it
 * as "the value passed".
 */
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
  return compiled.regex.test(value)
    ? { status: "match" }
    : { status: "no-match" };
}
