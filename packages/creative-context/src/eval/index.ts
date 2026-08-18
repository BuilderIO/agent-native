import type {
  EmbeddingFamily,
  MultimodalEmbeddingInput,
} from "../embeddings/types.js";

export {
  assertContextAcceptanceGates,
  ContextAcceptanceReportSchema,
  createBlindPreferencePacket,
  runContextAcceptanceEvaluation,
  scoreBlindPreferences,
  type BlindPreferenceAnswerKey,
  type BlindPreferenceWorksheetRow,
  type ContextAcceptanceArtifact,
  type ContextAcceptanceCase,
  type ContextAcceptanceReport,
  type ContextAcceptanceThresholds,
} from "./acceptance.js";
export { CREATIVE_CONTEXT_ACCEPTANCE_CASES } from "./acceptance-fixtures.js";

export {
  CREATIVE_CONTEXT_INK_IMAGE_BASE64,
  CREATIVE_CONTEXT_GOLD_DOCUMENTS,
  CREATIVE_CONTEXT_GOLD_TASKS,
  CREATIVE_CONTEXT_PURPLE_IMAGE_BASE64,
  type CreativeContextGoldDocument,
} from "./fixtures.js";

export interface RetrievalEvalTask {
  id: string;
  query: MultimodalEmbeddingInput;
  relevantKeys: readonly string[];
  forbiddenKeys?: readonly string[];
}

export interface RetrievalEvalMetrics {
  taskCount: number;
  top5Recall: number;
  meanReciprocalRank: number;
  permissionLeaks: number;
}

export interface ContextQualityTrial {
  id: string;
  preferred: "context-on" | "context-off" | "tie";
  baselineEditDistance: number;
  contextEditDistance: number;
}

export interface ContextQualityMetrics {
  trialCount: number;
  contextPreferenceRate: number;
  meanEditDistanceReduction: number;
}

export interface CreativeContextCorrectnessEvidence {
  permissionLeaks: number;
  generationsMissingPacks: number;
  generationsMissingProvenance: number;
  importsResumable: boolean;
  importsIdempotent: boolean;
  importsDeterministic: boolean;
  revocationRemovesAccess: boolean;
  lexicalLaneRebuilds: boolean;
  vectorLaneRebuilds: boolean;
  connectorsPassing: readonly string[];
  consumersUsingReuseLadder: readonly string[];
  nativeCodeRetrievalPassing: readonly string[];
  nativeCloneFidelityPassing: readonly string[];
  nativeCloneVersionsPinned: boolean;
  supportedNativeElementsEditable: boolean;
  runtimeExcludesFullResolutionReferenceRenders: boolean;
  contextOptOutExcludesAllContext: boolean;
  contextOnBeatsContextOff: boolean;
}

const REQUIRED_CONNECTORS = [
  "upload",
  "website",
  "figma",
  "notion",
  "google-slides",
] as const;
const REQUIRED_CONSUMERS = ["slides", "assets", "design", "content"] as const;
const REQUIRED_NATIVE_CONSUMERS = ["slides", "design"] as const;

export function evaluateRankings(
  tasks: readonly RetrievalEvalTask[],
  rankings: Readonly<Record<string, readonly string[]>>,
): RetrievalEvalMetrics {
  if (tasks.length === 0) {
    return {
      taskCount: 0,
      top5Recall: 0,
      meanReciprocalRank: 0,
      permissionLeaks: 0,
    };
  }
  let top5 = 0;
  let reciprocalRank = 0;
  let permissionLeaks = 0;
  for (const task of tasks) {
    const ranking = rankings[task.id] ?? [];
    const relevant = new Set(task.relevantKeys);
    if (ranking.slice(0, 5).some((key) => relevant.has(key))) top5 += 1;
    const first = ranking.findIndex((key) => relevant.has(key));
    if (first >= 0) reciprocalRank += 1 / (first + 1);
    const forbidden = new Set(task.forbiddenKeys ?? []);
    permissionLeaks += ranking.filter((key) => forbidden.has(key)).length;
  }
  return {
    taskCount: tasks.length,
    top5Recall: top5 / tasks.length,
    meanReciprocalRank: reciprocalRank / tasks.length,
    permissionLeaks,
  };
}

export function evaluateContextQuality(
  trials: readonly ContextQualityTrial[],
): ContextQualityMetrics {
  if (!trials.length) {
    return {
      trialCount: 0,
      contextPreferenceRate: 0,
      meanEditDistanceReduction: 0,
    };
  }
  const preferred = trials.filter(
    (trial) => trial.preferred === "context-on",
  ).length;
  const reduction = trials.reduce((total, trial) => {
    if (trial.baselineEditDistance <= 0) return total;
    return (
      total +
      (trial.baselineEditDistance - trial.contextEditDistance) /
        trial.baselineEditDistance
    );
  }, 0);
  return {
    trialCount: trials.length,
    contextPreferenceRate: preferred / trials.length,
    meanEditDistanceReduction: reduction / trials.length,
  };
}

export function creativeContextCompletionFailures(
  evidence: CreativeContextCorrectnessEvidence,
): string[] {
  const failures: string[] = [];
  if (evidence.permissionLeaks !== 0) failures.push("permission leaks");
  if (evidence.generationsMissingPacks !== 0)
    failures.push("generations missing context packs");
  if (evidence.generationsMissingProvenance !== 0)
    failures.push("generations missing provenance");
  if (!evidence.importsResumable) failures.push("imports are not resumable");
  if (!evidence.importsIdempotent) failures.push("imports are not idempotent");
  if (!evidence.importsDeterministic)
    failures.push("imports are not deterministic");
  if (!evidence.revocationRemovesAccess)
    failures.push("revocation does not remove retrieval access");
  if (!evidence.lexicalLaneRebuilds)
    failures.push("lexical retrieval cannot rebuild from canonical data");
  if (!evidence.vectorLaneRebuilds)
    failures.push("vector retrieval cannot rebuild from canonical data");
  const connectorSet = new Set(evidence.connectorsPassing);
  const missingConnectors = REQUIRED_CONNECTORS.filter(
    (connector) => !connectorSet.has(connector),
  );
  if (missingConnectors.length)
    failures.push(`connectors missing: ${missingConnectors.join(", ")}`);
  const consumerSet = new Set(evidence.consumersUsingReuseLadder);
  const missingConsumers = REQUIRED_CONSUMERS.filter(
    (consumer) => !consumerSet.has(consumer),
  );
  if (missingConsumers.length)
    failures.push(`reuse ladder missing: ${missingConsumers.join(", ")}`);
  const nativeRetrievalSet = new Set(evidence.nativeCodeRetrievalPassing);
  const missingNativeRetrieval = REQUIRED_NATIVE_CONSUMERS.filter(
    (consumer) => !nativeRetrievalSet.has(consumer),
  );
  if (missingNativeRetrieval.length) {
    failures.push(
      `native code retrieval missing: ${missingNativeRetrieval.join(", ")}`,
    );
  }
  const nativeFidelitySet = new Set(evidence.nativeCloneFidelityPassing);
  const missingNativeFidelity = REQUIRED_NATIVE_CONSUMERS.filter(
    (consumer) => !nativeFidelitySet.has(consumer),
  );
  if (missingNativeFidelity.length) {
    failures.push(
      `native clone fidelity missing: ${missingNativeFidelity.join(", ")}`,
    );
  }
  if (!evidence.nativeCloneVersionsPinned) {
    failures.push("native clone versions are not pinned");
  }
  if (!evidence.supportedNativeElementsEditable) {
    failures.push("supported native elements are not editable");
  }
  if (!evidence.runtimeExcludesFullResolutionReferenceRenders) {
    failures.push("runtime context includes full-resolution reference renders");
  }
  if (!evidence.contextOptOutExcludesAllContext)
    failures.push("context opt-out does not exclude all context");
  if (!evidence.contextOnBeatsContextOff)
    failures.push("context-on does not beat context-off");
  return failures;
}

export function assertCreativeContextCompletionGates(
  evidence: CreativeContextCorrectnessEvidence,
): void {
  const failures = creativeContextCompletionFailures(evidence);
  if (failures.length) {
    throw new Error(
      `Creative context completion gates failed: ${failures.join("; ")}`,
    );
  }
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return Number.NEGATIVE_INFINITY;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export async function bakeOffEmbeddingFamilies(input: {
  families: readonly EmbeddingFamily[];
  documents: Readonly<Record<string, MultimodalEmbeddingInput>>;
  tasks: readonly RetrievalEvalTask[];
  allowedDocumentKeys?: readonly string[];
  topK?: number;
}): Promise<{ family: EmbeddingFamily; metrics: RetrievalEvalMetrics }[]> {
  const documentEntries = Object.entries(input.documents);
  const allowed = input.allowedDocumentKeys
    ? new Set(input.allowedDocumentKeys)
    : null;
  const results = await Promise.all(
    input.families.map(async (family) => {
      const documentVectors = await family.embed(
        documentEntries.map(([, value]) => value),
        "document",
      );
      const queryVectors = await family.embed(
        input.tasks.map((task) => task.query),
        "query",
      );
      const rankings: Record<string, string[]> = {};
      input.tasks.forEach((task, taskIndex) => {
        const query = queryVectors[taskIndex] ?? [];
        rankings[task.id] = documentEntries
          .filter(([key]) => !allowed || allowed.has(key))
          .map(([key], index) => ({
            key,
            score: cosine(query, documentVectors[index] ?? []),
          }))
          .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
          .slice(0, Math.max(5, input.topK ?? 20))
          .map((entry) => entry.key);
      });
      return { family, metrics: evaluateRankings(input.tasks, rankings) };
    }),
  );
  return results.sort(
    (a, b) =>
      a.metrics.permissionLeaks - b.metrics.permissionLeaks ||
      b.metrics.top5Recall - a.metrics.top5Recall ||
      b.metrics.meanReciprocalRank - a.metrics.meanReciprocalRank,
  );
}

export function embeddingBakeoffPasses(metrics: RetrievalEvalMetrics): boolean {
  return (
    metrics.taskCount >= 6 &&
    metrics.permissionLeaks === 0 &&
    metrics.top5Recall >= 0.8 &&
    metrics.meanReciprocalRank >= 0.35
  );
}
