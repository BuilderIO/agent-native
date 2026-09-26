import { z } from "zod";

import {
  BRAIN_SENSITIVITY_CATEGORIES,
  BRAIN_SENSITIVITY_POLICY_VERSION,
  type BrainSafeSegment,
  type BrainSensitivityCategory,
  type BrainSensitivityDecision,
} from "./search-index-contracts.js";

export const MAX_CLASSIFIER_OUTPUT_CHARS = 80_000;
export const classifierDecisionSchema = z
  .object({
    disposition: z.enum(["allowed", "suppressed", "quarantined"]),
    categories: z.array(z.enum(BRAIN_SENSITIVITY_CATEGORIES)).max(12),
    safeContent: z.string().max(MAX_CLASSIFIER_OUTPUT_CHARS),
    safeSegments: z
      .array(
        z.object({
          text: z.string().min(1).max(8_000),
          sourceUrl: z.string().url().optional(),
        }),
      )
      .max(50),
  })
  .strict();

export function sanitizeSensitiveText(value: string): string {
  return (
    value
      // Credentials run first. The phone-number rule below matches the digit
      // runs inside tokens like `xoxb-000000000000-...`, and once it rewrites
      // the middle the credential patterns no longer match, leaving the tail
      // of a live secret in the output.
      .replace(UNLABELLED_CREDENTIAL_PATTERN, "[redacted]")
      .replace(LABELLED_CREDENTIAL_PATTERN, "$1: [redacted]")
      .replace(/<mailto:[^>|]+(?:\|[^>]+)?>/gi, "[redacted]")
      .replace(/<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g, "[redacted]")
      .replace(/\bU[A-Z0-9]{8,}\b/g, "[redacted]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
      .replace(/(?:\+?\d|\(\d{2,4}\))[\d\s().-]{6,}\d/g, (candidate) =>
        /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "[redacted]",
      )
      .replace(/https?:\/\/\S+/gi, "[link]")
  );
}

/**
 * Unlabelled provider credential formats, listed once because they are needed
 * in two places that must not drift: the `secret-credential` hard-category
 * screen (which suppresses the whole capture) and `sanitizeSensitiveText`
 * (which redacts anything leaving the process). A format present in only the
 * redactor would let a credential-bearing capture be stored as "allowed".
 *
 * This list is defence in depth with a long tail, not the primary control.
 * Labelled secrets are caught by the `CREDENTIAL_LABEL_PATTERN` below, and the
 * classifier's `secret-credential` question covers formats nobody enumerated.
 */
const UNLABELLED_CREDENTIAL_SOURCES = [
  String.raw`\b(?:sk|pk|rk|ghp|gho|ghu|github_pat)[_-][A-Za-z0-9_=-]{12,}\b`,
  String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`,
  String.raw`\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b`,
  String.raw`\bAIza[A-Za-z0-9_-]{35}\b`,
  String.raw`\bGOCSPX-[A-Za-z0-9_-]{20,}\b`,
  String.raw`\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`,
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  String.raw`\b(?:Authorization\s*:\s*)?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}`,
] as const;

/**
 * Labels that introduce a secret value. Shared so the detector and the
 * redactor cannot recognise different sets: a label in only the detector
 * suppresses without redacting, and one in only the redactor leaves a
 * credential-bearing capture stored as "allowed".
 */
const CREDENTIAL_LABELS = String.raw`password|passcode|secret|token|api[-_ ]?key|access[-_ ]?token|private[-_ ]?key`;

const CREDENTIAL_LABEL_PATTERN = String.raw`\b(?:${CREDENTIAL_LABELS})\s*[:=]`;

const UNLABELLED_CREDENTIAL_PATTERN = new RegExp(
  UNLABELLED_CREDENTIAL_SOURCES.join("|"),
  "gi",
);

const LABELLED_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(${CREDENTIAL_LABELS})\s*[:=]\s*\S+`,
  "gi",
);

const CREDENTIAL_PATTERN = new RegExp(
  [CREDENTIAL_LABEL_PATTERN, ...UNLABELLED_CREDENTIAL_SOURCES].join("|"),
  "i",
);

const HARD_CATEGORY_PATTERNS: ReadonlyArray<
  readonly [BrainSensitivityCategory, RegExp]
> = [
  [
    "performance",
    /\b(performance review|under[- ]?perform(?:er|ing)?|low performer|performance concern)\b/i,
  ],
  [
    "discipline",
    /\b(performance improvement plan|start (?:a )?pip|(?:place(?:d)?|put) (?:them|her|him|the employee) on (?:a )?pip|written warning|disciplinary action|final warning)\b/i,
  ],
  [
    "termination",
    /\b(employment termination|terminate the employee|terminat(?:e|ed|ion) (?:their|his|her|the employee'?s?) employment|fired|fire\s+(?:them|her|him)|severance (?:agreement|package|pay))\b/i,
  ],
  [
    "layoff-reorg",
    /\b(layoffs?|rif|reorg(?:anization)?|rightsizing|roles? impacted|role eliminat(?:ion|ed)|workforce reduction)\b/i,
  ],
  [
    "compensation",
    /\b(compensation (?:review|discussion|adjustment|change)|salary|(?:annual|signing|performance|retention) bonus|bonus (?:amount|payout|target)|equity grant|stock options?|pay band|payroll|pay raise|salary increase|comp adjustment)\b/i,
  ],
  [
    "recruiting",
    /\b(candidate|applicant|interview(?:er|ing)?|recruit(?:er|ing)?|resume|résumé|reference check|job offer|shortlist|hiring panel)\b/i,
  ],
  [
    "health-accommodation",
    /\b(health condition|medical (?:condition|diagnosis|leave|record|accommodation)|doctor(?:'s)? note|disability accommodation|workplace accommodation|fmla|mental health (?:condition|leave|accommodation)|pregnan(?:t|cy))\b/i,
  ],
  [
    "investigation",
    /\b(investigation|investigat(?:e|ing|ed)|harassment complaint|misconduct|whistleblower|ethics complaint)\b/i,
  ],
  [
    "privileged-legal",
    /\b(attorney[- ]client|legal privilege|privileged and confidential|outside counsel|litigation hold)\b/i,
  ],
  ["secret-credential", CREDENTIAL_PATTERN],
];

const PERSONAL_PATTERN =
  /\b(home address|social security|ssn|birthday|spouse|husband|wife|children?)\b/i;
const PROMPT_INJECTION_PATTERN =
  /\b(ignore (?:previous|all|privacy)|override (?:the |all )?(?:policy|rules)|reveal (?:the )?(?:secret|private)|persist every)\b/i;
export interface DeterministicSensitivityScreen {
  categories: BrainSensitivityCategory[];
  sensitiveLines: string[];
  safeLines: string[];
}

export function screenSensitivityDeterministically(
  content: string,
): DeterministicSensitivityScreen {
  const categories = new Set<BrainSensitivityCategory>();
  const sensitiveLines: string[] = [];
  const safeLines: string[] = [];

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line) continue;
    let sensitive = false;
    for (const [category, pattern] of HARD_CATEGORY_PATTERNS) {
      if (!pattern.test(line)) continue;
      categories.add(category);
      sensitive = true;
    }
    if (PERSONAL_PATTERN.test(line)) {
      categories.add("personal");
      sensitive = true;
    }
    if (PROMPT_INJECTION_PATTERN.test(line)) sensitive = true;
    (sensitive ? sensitiveLines : safeLines).push(line);
  }

  return { categories: [...categories], sensitiveLines, safeLines };
}

export function fallbackSensitivityDecision(
  content: string,
  capturedAt: string,
): BrainSensitivityDecision {
  const screen = screenSensitivityDeterministically(content);
  const safeContent = screen.safeLines
    .join("\n")
    .slice(0, MAX_CLASSIFIER_OUTPUT_CHARS);
  const safeSegments: BrainSafeSegment[] = safeContent
    ? [{ id: "safe-1", capturedAt, text: safeContent, reactionCount: 0 }]
    : [];
  const disposition =
    screen.categories.length || screen.sensitiveLines.length || !safeContent
      ? "quarantined"
      : "allowed";
  return {
    disposition,
    categories: screen.categories,
    confidenceBand:
      disposition === "allowed" || screen.categories.length
        ? "deterministic"
        : "uncertain",
    policyVersion: BRAIN_SENSITIVITY_POLICY_VERSION,
    safeSegments,
    safeContent,
    classifier: "deterministic",
  };
}

export function deterministicQuarantineDecision(
  content: string,
  capturedAt: string,
): BrainSensitivityDecision | null {
  const screen = screenSensitivityDeterministically(content);
  if (!screen.categories.length) return null;
  const safeContent = screen.safeLines
    .join("\n")
    .slice(0, MAX_CLASSIFIER_OUTPUT_CHARS);
  return {
    disposition: "suppressed",
    categories: screen.categories,
    confidenceBand: "deterministic",
    policyVersion: BRAIN_SENSITIVITY_POLICY_VERSION,
    safeSegments: safeContent
      ? [{ id: "safe-1", capturedAt, text: safeContent, reactionCount: 0 }]
      : [],
    safeContent,
    classifier: "deterministic",
  };
}
