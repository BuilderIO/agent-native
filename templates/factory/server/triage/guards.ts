import type {
  GuardResult,
  TriageGuardCode,
  TriagePolicyGuards,
} from "./contracts.js";

export function evaluateStructuredGuards(
  guards: TriagePolicyGuards,
  input: {
    repository?: string;
    changedFiles?: string[];
    diffLines?: number;
    risk?: string;
    categories?: TriageGuardCode[];
  },
): GuardResult[] {
  const results: GuardResult[] = [];

  for (const category of input.categories ?? []) {
    if (guards.neverAutomate.includes(category)) {
      results.push({
        code: category,
        passed: false,
        reason: `The ${category} category is always human-gated.`,
      });
    }
  }

  if (guards.allowRepositories.length > 0) {
    results.push({
      code: "unknown_change",
      passed:
        !!input.repository &&
        guards.allowRepositories.includes(input.repository),
      reason: input.repository
        ? `Repository ${input.repository} is not in the allowlist.`
        : "Repository is unavailable.",
    });
  }

  const changedFiles = input.changedFiles ?? [];
  const deniedPath = changedFiles.find((file) =>
    guards.denyPathPrefixes.some((prefix) => file.startsWith(prefix)),
  );
  if (deniedPath) {
    results.push({
      code: guardCodeForPath(deniedPath),
      passed: false,
      reason: `Sensitive path is present: ${deniedPath}`,
    });
  }

  if (
    guards.maxChangedFiles !== null &&
    changedFiles.length > guards.maxChangedFiles
  ) {
    results.push({
      code: "diff_too_large",
      passed: false,
      reason: `${changedFiles.length} changed files exceeds the limit of ${guards.maxChangedFiles}.`,
    });
  }

  if (
    guards.maxDiffLines !== null &&
    typeof input.diffLines === "number" &&
    input.diffLines > guards.maxDiffLines
  ) {
    results.push({
      code: "diff_too_large",
      passed: false,
      reason: `${input.diffLines} diff lines exceeds the limit of ${guards.maxDiffLines}.`,
    });
  }

  if (input.risk === "high" || input.risk === "critical") {
    results.push({
      code: "security",
      passed: false,
      reason: `Risk ${input.risk} is always human-gated in shadow mode.`,
    });
  }

  if (results.length === 0) {
    const hasEvidence = Boolean(
      input.repository ||
      (input.changedFiles && input.changedFiles.length > 0) ||
      input.diffLines !== undefined ||
      (input.risk && input.risk !== "unknown"),
    );
    results.push({
      code: "unknown_change",
      passed: hasEvidence,
      reason: hasEvidence
        ? "Structured evidence was available and no deny guard matched."
        : "Insufficient structured evidence for an autonomous proposal.",
    });
  }

  return results;
}

function guardCodeForPath(path: string): TriageGuardCode {
  const normalized = path.toLowerCase();
  if (normalized.startsWith("packages/")) return "publishable_package";
  if (normalized.includes("migration")) return "migration";
  if (normalized.includes("credential") || normalized.startsWith(".env")) {
    return "credentials";
  }
  if (normalized.includes("vault")) return "vault";
  if (normalized.includes("payment")) return "payments";
  if (normalized.includes("security")) return "security";
  if (
    normalized.includes("auth") ||
    normalized.includes("session") ||
    normalized.includes("identity")
  ) {
    return "auth";
  }
  return "path_denied";
}
