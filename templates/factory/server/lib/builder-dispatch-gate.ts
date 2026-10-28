import {
  triageGuardCodeSchema,
  type TriageGuardCode,
} from "../triage/contracts.js";

/**
 * The bar a report must clear before Builder is started on it. It is pure:
 * every fact it judges is passed in, so the same facts always give the same
 * answer.
 *
 * A missing or unreadable input is a refusal, never a pass. The thresholds are
 * code, not graph settings: a workflow decides what it passes in, not what is
 * good enough.
 *
 * Duplicates are not judged here: a start sees only its own fields, never the
 * other reports or their runs, so a check that read them would always pass. A
 * second start for the same work is caught by its branch name in
 * `builder-operations`.
 */

/**
 * Kinds of change no automation starts work on, whatever else is true:
 * identity and access, secrets, data migrations, money, and anything marked
 * security. `owner_owned` is left out on purpose: who owns an app is a routing
 * decision with named exceptions, not a hard line.
 */
export const HARD_NEVER_AUTOMATE_GUARD_CODES = [
  "auth",
  "session",
  "identity",
  "credentials",
  "vault",
  "migration",
  "payments",
  "security",
  "publishable_package",
] as const satisfies readonly TriageGuardCode[];

/** The guard codes a change may be labelled with. Anything else is refused as unrecognized. */
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(
  triageGuardCodeSchema.options,
);

export const BUILDER_DISPATCH_REASON_CODES = [
  "gate_input_invalid",
  "not_clear_bug",
  "product_ux_implications",
  "risk_not_low",
  "confidence_not_high",
  "already_claimed",
  "never_automate_category",
  "category_unrecognized",
] as const;
type BuilderDispatchReasonCode = (typeof BUILDER_DISPATCH_REASON_CODES)[number];

export interface BuilderDispatchInput {
  clearBug: boolean;
  productUxImplications: boolean;
  /** Only `low` is dispatched; `unknown` is a refusal like any other. */
  risk: string;
  /** Only `high` is dispatched. */
  confidence: string;
  /** A person already reacted to the report, so it is theirs. */
  alreadyClaimed: boolean;
  /** What the change touches, as guard codes. Empty when nothing sensitive. */
  categories: readonly string[];
}

type BuilderDispatchAssessment =
  | { allowed: true }
  | {
      allowed: false;
      reasonCodes: BuilderDispatchReasonCode[];
      message: string;
    };

/** One thing the gate looked at. */
interface BuilderDispatchCheck {
  reasonCode: BuilderDispatchReasonCode;
  passed: boolean;
  reason: string;
}

function clearBugCheck(input: Pick<BuilderDispatchInput, "clearBug">) {
  return check(
    "not_clear_bug",
    input.clearBug,
    "The automation classified a concrete, reproducible bug or error report.",
    "The report is not a clear bug, so no external work was started.",
  );
}

function productUxCheck(
  input: Pick<BuilderDispatchInput, "productUxImplications">,
) {
  return check(
    "product_ux_implications",
    !input.productUxImplications,
    "No product or UX decision was detected.",
    "Product or UX implications require manual ownership.",
  );
}

function riskCheck(input: Pick<BuilderDispatchInput, "risk">) {
  return check(
    "risk_not_low",
    input.risk === "low",
    "Risk is low.",
    `Risk ${input.risk} is above the auto-dispatch bar and requires manual review.`,
  );
}

function confidenceCheck(input: Pick<BuilderDispatchInput, "confidence">) {
  return check(
    "confidence_not_high",
    input.confidence === "high",
    "Confidence is high.",
    `Confidence ${input.confidence} is below the auto-dispatch bar and requires manual review.`,
  );
}

function check(
  reasonCode: BuilderDispatchReasonCode,
  passed: boolean,
  passedReason: string,
  failedReason: string,
): BuilderDispatchCheck {
  return {
    reasonCode,
    passed,
    reason: passed ? passedReason : failedReason,
  };
}

/** The four judgements every dispatch is held to, in a fixed order. */
export function coreDispatchChecks(
  input: Pick<
    BuilderDispatchInput,
    "clearBug" | "productUxImplications" | "risk" | "confidence"
  >,
): BuilderDispatchCheck[] {
  return [
    clearBugCheck(input),
    productUxCheck(input),
    riskCheck(input),
    confidenceCheck(input),
  ];
}

function claimedCheck(
  input: Pick<BuilderDispatchInput, "alreadyClaimed">,
): BuilderDispatchCheck {
  return check(
    "already_claimed",
    !input.alreadyClaimed,
    "No person has claimed this report.",
    "A person already claimed this report, so Builder is not started on it.",
  );
}

function categoryChecks(categories: readonly string[]): BuilderDispatchCheck[] {
  const unknown = categories.filter((name) => !KNOWN_CATEGORIES.has(name));
  const hard = HARD_NEVER_AUTOMATE_GUARD_CODES.filter((code) =>
    categories.includes(code),
  );
  return [
    check(
      "category_unrecognized",
      unknown.length === 0,
      "Every change category is one the gate knows.",
      `Unrecognized change categories: ${unknown.join(", ")}. Use only ${triageGuardCodeSchema.options.join(", ")}, or an empty list when none applies.`,
    ),
    check(
      "never_automate_category",
      hard.length === 0,
      "The change touches nothing that is never started automatically.",
      `The change touches ${hard.join(", ")}, which is never started automatically.`,
    ),
  ];
}

/** Every check the gate runs, passed or not, in a fixed order. */
export function builderDispatchChecks(
  input: BuilderDispatchInput,
): BuilderDispatchCheck[] {
  return [
    ...coreDispatchChecks(input),
    claimedCheck(input),
    ...categoryChecks(input.categories),
  ];
}

/** Whether Builder may be started, and if not, every reason why, so one refusal names them all. */
export function assessBuilderDispatch(
  input: BuilderDispatchInput,
): BuilderDispatchAssessment {
  const failed = builderDispatchChecks(input).filter((entry) => !entry.passed);
  if (failed.length === 0) return { allowed: true };
  return {
    allowed: false,
    reasonCodes: failed.map((entry) => entry.reasonCode),
    message: failed.map((entry) => entry.reason).join(" "),
  };
}

const INPUT_FIELDS = [
  "clearBug",
  "productUxImplications",
  "risk",
  "confidence",
  "alreadyClaimed",
  "categories",
] as const;
type InputField = (typeof INPUT_FIELDS)[number];

type BuilderDispatchRefusal = Extract<
  BuilderDispatchAssessment,
  { allowed: false }
>;

/**
 * Reads the gate's inputs from an operation's fields. A field that is absent
 * or the wrong type refuses the call and is named, so an input nobody bound
 * can never read as a clean value.
 */
export function readBuilderDispatchFields(
  fields: Readonly<Record<string, unknown>>,
):
  | { ok: true; input: BuilderDispatchInput }
  | { ok: false; refusal: BuilderDispatchRefusal } {
  const bad: InputField[] = [];
  const flag = (name: InputField): boolean => {
    const value = fields[name];
    if (typeof value === "boolean") return value;
    bad.push(name);
    return false;
  };
  const word = (name: InputField): string => {
    const value = fields[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    bad.push(name);
    return "";
  };
  const list = (name: InputField): string[] => {
    const value = fields[name];
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ) {
      return value.map((entry) => entry.trim());
    }
    bad.push(name);
    return [];
  };
  const input: BuilderDispatchInput = {
    clearBug: flag("clearBug"),
    productUxImplications: flag("productUxImplications"),
    risk: word("risk"),
    confidence: word("confidence"),
    alreadyClaimed: flag("alreadyClaimed"),
    categories: list("categories"),
  };
  if (bad.length > 0) {
    return {
      ok: false,
      refusal: {
        allowed: false,
        reasonCodes: ["gate_input_invalid"],
        message: `The dispatch gate needs ${bad.join(", ")} set to a value of the right type; none may be left out.`,
      },
    };
  }
  return { ok: true, input };
}
