import { createHash } from "node:crypto";

import { z } from "zod";

export interface ContextAcceptanceArtifact {
  output: string;
  usedContextKeys: readonly string[];
  contextPackId?: string | null;
  provenanceKeys?: readonly string[];
}

export interface ContextAcceptanceCase {
  id: string;
  prompt: string;
  reference: string;
  expectedContextKeys: readonly string[];
  requiredTerms: readonly string[];
  forbiddenTerms: readonly string[];
  contextOff: ContextAcceptanceArtifact;
  contextOn: ContextAcceptanceArtifact;
}

export interface ContextAcceptanceThresholds {
  minimumCases: number;
  minimumContextOnWinRate: number;
  minimumRequiredTermCoverage: number;
  minimumMeanEditDistanceReduction: number;
}

const DEFAULT_THRESHOLDS: ContextAcceptanceThresholds = {
  minimumCases: 4,
  minimumContextOnWinRate: 0.75,
  minimumRequiredTermCoverage: 1,
  minimumMeanEditDistanceReduction: 0,
};

const ConditionSchema = z.object({
  outputHash: z.string().regex(/^[a-f0-9]{64}$/),
  requiredTermCoverage: z.number().min(0).max(1),
  forbiddenHits: z.array(z.string()),
  editDistance: z.number().int().nonnegative(),
  usedContextKeys: z.array(z.string()),
  contextPackId: z.string().nullable(),
  provenanceKeys: z.array(z.string()),
});

export const ContextAcceptanceReportSchema = z.object({
  schemaVersion: z.literal(1),
  corpusId: z.string().min(1),
  runId: z.string().regex(/^cc-eval-[a-f0-9]{16}$/),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      contextOff: ConditionSchema,
      contextOn: ConditionSchema,
      winner: z.enum(["context-on", "context-off", "tie"]),
      contextPackRecorded: z.boolean(),
      provenanceComplete: z.boolean(),
      optOutStructurallyClean: z.boolean(),
    }),
  ),
  summary: z.object({
    caseCount: z.number().int().nonnegative(),
    contextOnWins: z.number().int().nonnegative(),
    contextOffWins: z.number().int().nonnegative(),
    ties: z.number().int().nonnegative(),
    contextOnWinRate: z.number().min(0).max(1),
    contextOnRequiredTermCoverage: z.number().min(0).max(1),
    meanEditDistanceReduction: z.number(),
    forbiddenOutputHits: z.number().int().nonnegative(),
    missingContextPacks: z.number().int().nonnegative(),
    missingProvenance: z.number().int().nonnegative(),
    optOutContamination: z.number().int().nonnegative(),
  }),
  thresholds: z.object({
    minimumCases: z.number().int().positive(),
    minimumContextOnWinRate: z.number().min(0).max(1),
    minimumRequiredTermCoverage: z.number().min(0).max(1),
    minimumMeanEditDistanceReduction: z.number(),
  }),
  gates: z.object({ passed: z.boolean(), failures: z.array(z.string()) }),
  manualBlindPreference: z.object({
    status: z.enum(["pending", "complete"]),
    scoredTrials: z.number().int().nonnegative(),
    contextOnPreferenceRate: z.number().min(0).max(1).nullable(),
  }),
});

export type ContextAcceptanceReport = z.infer<
  typeof ContextAcceptanceReportSchema
>;

function normalized(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function unique(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

function condition(
  artifact: ContextAcceptanceArtifact,
  acceptanceCase: ContextAcceptanceCase,
) {
  const output = normalized(artifact.output);
  const required = unique(acceptanceCase.requiredTerms);
  const forbidden = unique(acceptanceCase.forbiddenTerms).filter((term) =>
    output.includes(normalized(term)),
  );
  const matched = required.filter((term) => output.includes(normalized(term)));
  return {
    outputHash: createHash("sha256").update(artifact.output).digest("hex"),
    requiredTermCoverage: required.length
      ? matched.length / required.length
      : 1,
    forbiddenHits: forbidden,
    editDistance: levenshtein(output, normalized(acceptanceCase.reference)),
    usedContextKeys: unique(artifact.usedContextKeys),
    contextPackId: artifact.contextPackId?.trim() || null,
    provenanceKeys: unique(artifact.provenanceKeys ?? []),
  };
}

function winner(
  off: ReturnType<typeof condition>,
  on: ReturnType<typeof condition>,
): "context-on" | "context-off" | "tie" {
  if (on.forbiddenHits.length !== off.forbiddenHits.length) {
    return on.forbiddenHits.length < off.forbiddenHits.length
      ? "context-on"
      : "context-off";
  }
  if (on.requiredTermCoverage !== off.requiredTermCoverage) {
    return on.requiredTermCoverage > off.requiredTermCoverage
      ? "context-on"
      : "context-off";
  }
  if (on.editDistance !== off.editDistance) {
    return on.editDistance < off.editDistance ? "context-on" : "context-off";
  }
  return "tie";
}

export function runContextAcceptanceEvaluation(input: {
  corpusId: string;
  cases: readonly ContextAcceptanceCase[];
  thresholds?: Partial<ContextAcceptanceThresholds>;
}): ContextAcceptanceReport {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const cases = [...input.cases]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((acceptanceCase) => {
      const contextOff = condition(acceptanceCase.contextOff, acceptanceCase);
      const contextOn = condition(acceptanceCase.contextOn, acceptanceCase);
      const expected = new Set(unique(acceptanceCase.expectedContextKeys));
      const contextPackRecorded = Boolean(contextOn.contextPackId);
      const provenanceComplete = [...expected].every((key) =>
        contextOn.provenanceKeys.includes(key),
      );
      const optOutStructurallyClean =
        contextOff.usedContextKeys.length === 0 &&
        contextOff.contextPackId === null &&
        contextOff.provenanceKeys.length === 0;
      return {
        id: acceptanceCase.id,
        contextOff,
        contextOn,
        winner: winner(contextOff, contextOn),
        contextPackRecorded,
        provenanceComplete,
        optOutStructurallyClean,
      };
    });
  const count = cases.length;
  const contextOnWins = cases.filter(
    (entry) => entry.winner === "context-on",
  ).length;
  const contextOffWins = cases.filter(
    (entry) => entry.winner === "context-off",
  ).length;
  const ties = count - contextOnWins - contextOffWins;
  const average = (values: readonly number[]) =>
    values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 0;
  const summary = {
    caseCount: count,
    contextOnWins,
    contextOffWins,
    ties,
    contextOnWinRate: count ? contextOnWins / count : 0,
    contextOnRequiredTermCoverage: average(
      cases.map((entry) => entry.contextOn.requiredTermCoverage),
    ),
    meanEditDistanceReduction: average(
      cases.map((entry) => {
        const baseline = entry.contextOff.editDistance;
        return baseline > 0
          ? (baseline - entry.contextOn.editDistance) / baseline
          : entry.contextOn.editDistance === 0
            ? 0
            : -1;
      }),
    ),
    forbiddenOutputHits: cases.reduce(
      (total, entry) => total + entry.contextOn.forbiddenHits.length,
      0,
    ),
    missingContextPacks: cases.filter((entry) => !entry.contextPackRecorded)
      .length,
    missingProvenance: cases.filter((entry) => !entry.provenanceComplete)
      .length,
    optOutContamination: cases.filter((entry) => !entry.optOutStructurallyClean)
      .length,
  };
  const failures: string[] = [];
  if (summary.caseCount < thresholds.minimumCases) {
    failures.push(
      `case count ${summary.caseCount} is below ${thresholds.minimumCases}`,
    );
  }
  if (summary.contextOnWinRate < thresholds.minimumContextOnWinRate) {
    failures.push(
      `context-on win rate ${summary.contextOnWinRate.toFixed(3)} is below ${thresholds.minimumContextOnWinRate.toFixed(3)}`,
    );
  }
  if (
    summary.contextOnRequiredTermCoverage <
    thresholds.minimumRequiredTermCoverage
  ) {
    failures.push(
      `required-term coverage ${summary.contextOnRequiredTermCoverage.toFixed(3)} is below ${thresholds.minimumRequiredTermCoverage.toFixed(3)}`,
    );
  }
  if (
    summary.meanEditDistanceReduction <
    thresholds.minimumMeanEditDistanceReduction
  ) {
    failures.push(
      `edit-distance reduction ${summary.meanEditDistanceReduction.toFixed(3)} is below ${thresholds.minimumMeanEditDistanceReduction.toFixed(3)}`,
    );
  }
  if (summary.forbiddenOutputHits)
    failures.push("forbidden output was emitted");
  if (summary.missingContextPacks) failures.push("context packs are missing");
  if (summary.missingProvenance) failures.push("provenance is incomplete");
  if (summary.optOutContamination)
    failures.push("context-off contains context evidence");
  const report: ContextAcceptanceReport = {
    schemaVersion: 1,
    corpusId: input.corpusId,
    runId: `cc-eval-${createHash("sha256")
      .update(
        JSON.stringify({
          corpusId: input.corpusId,
          cases,
          thresholds,
        }),
      )
      .digest("hex")
      .slice(0, 16)}`,
    cases,
    summary,
    thresholds,
    gates: { passed: failures.length === 0, failures },
    manualBlindPreference: {
      status: "pending",
      scoredTrials: 0,
      contextOnPreferenceRate: null,
    },
  };
  return ContextAcceptanceReportSchema.parse(report);
}

export function assertContextAcceptanceGates(
  report: ContextAcceptanceReport,
): void {
  const parsed = ContextAcceptanceReportSchema.parse(report);
  if (!parsed.gates.passed) {
    throw new Error(
      `Creative context acceptance gates failed: ${parsed.gates.failures.join("; ")}`,
    );
  }
}

export interface BlindPreferenceWorksheetRow {
  caseId: string;
  prompt: string;
  candidateA: string;
  candidateB: string;
}

export interface BlindPreferenceAnswerKey {
  caseId: string;
  contextOnCandidate: "A" | "B";
}

export function createBlindPreferencePacket(
  cases: readonly ContextAcceptanceCase[],
): {
  worksheet: BlindPreferenceWorksheetRow[];
  answerKey: BlindPreferenceAnswerKey[];
} {
  const worksheet: BlindPreferenceWorksheetRow[] = [];
  const answerKey: BlindPreferenceAnswerKey[] = [];
  for (const entry of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
    const contextOnCandidate =
      parseInt(
        createHash("sha256").update(entry.id).digest("hex").slice(0, 2),
        16,
      ) % 2
        ? "A"
        : "B";
    worksheet.push({
      caseId: entry.id,
      prompt: entry.prompt,
      candidateA:
        contextOnCandidate === "A"
          ? entry.contextOn.output
          : entry.contextOff.output,
      candidateB:
        contextOnCandidate === "B"
          ? entry.contextOn.output
          : entry.contextOff.output,
    });
    answerKey.push({ caseId: entry.id, contextOnCandidate });
  }
  return { worksheet, answerKey };
}

export function scoreBlindPreferences(
  answerKey: readonly BlindPreferenceAnswerKey[],
  scores: Readonly<Record<string, "A" | "B" | "tie">>,
): { scoredTrials: number; contextOnPreferenceRate: number } {
  let scoredTrials = 0;
  let contextOnPreferences = 0;
  for (const entry of answerKey) {
    const score = scores[entry.caseId];
    if (!score) continue;
    scoredTrials++;
    if (score === entry.contextOnCandidate) contextOnPreferences++;
  }
  return {
    scoredTrials,
    contextOnPreferenceRate: scoredTrials
      ? contextOnPreferences / scoredTrials
      : 0,
  };
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}
