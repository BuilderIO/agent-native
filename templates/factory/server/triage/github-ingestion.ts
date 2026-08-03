import type { IngestionEnvelope } from "./contracts.js";
import type { PullRequestObservation } from "./pr-monitor.js";

export interface AiServicesPullRequestSnapshot extends PullRequestObservation {
  readonly title: string;
  readonly sourceUrl?: string;
  readonly summary?: string;
  readonly changedFiles?: readonly string[];
  readonly diffLines?: number;
  readonly coverage: "complete" | "partial" | "unknown" | "unavailable";
}

export function pullRequestSnapshotToEnvelope(
  snapshot: AiServicesPullRequestSnapshot,
): IngestionEnvelope {
  const externalId = `${snapshot.repo}#${snapshot.pullRequestNumber}@${snapshot.headSha}`;
  return {
    source: "github",
    externalId,
    receivedAt: snapshot.observedAt,
    ...(snapshot.sourceUrl ? { sourceUrl: snapshot.sourceUrl } : {}),
    title: snapshot.title,
    summary: snapshot.summary,
    repository: snapshot.repo,
    pullRequestNumber: snapshot.pullRequestNumber,
    headSha: snapshot.headSha,
    coverage: snapshot.coverage,
    metadata: {
      changedFiles: snapshot.changedFiles ? [...snapshot.changedFiles] : null,
      diffLines: snapshot.diffLines ?? null,
      reviews: snapshot.reviews.length,
      checks: snapshot.checks.length,
    },
  };
}
