import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  continueJob: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  getContextSource: vi.fn(),
  purgeContextSourceArtifacts: vi.fn(),
  updateJob: vi.fn(),
  dispatchCreativeContextImportJob: vi.fn(async () => undefined),
}));

vi.mock("../store/index.js", () => ({
  continueJob: mocks.continueJob,
  createJob: mocks.createJob,
  getJob: mocks.getJob,
  getContextSource: mocks.getContextSource,
  purgeContextSourceArtifacts: mocks.purgeContextSourceArtifacts,
  updateJob: mocks.updateJob,
}));

vi.mock("../jobs/index.js", () => ({
  dispatchCreativeContextImportJob: mocks.dispatchCreativeContextImportJob,
}));

vi.mock("../server/context.js", () => ({
  getCreativeContext: () => ({ connectorContext: { appId: "slides" } }),
}));

import continueImport from "./continue-context-import.js";
import processPurge from "./process-context-purge.js";
import startEnrichment from "./start-context-enrichment.js";
import startImport from "./start-context-import.js";

const privateJob = {
  id: "job-1",
  ownerEmail: "owner@example.test",
  orgId: "org-secret",
  sourceId: "source-1",
  kind: "import",
  status: "running",
  mode: "incremental",
  progressCurrent: 2,
  progressTotal: 4,
  attempts: 1,
  leaseOwner: "worker-private",
  leaseToken: "lease-private",
  leaseExpiresAt: "2026-07-16T02:00:00.000Z",
  nextResumeAt: null,
  budget: { token: "budget-private" },
  checkpoint: {
    blobRef: "creative-context-blob:v1:checkpoint-private",
    warning:
      "Fetched https://provider.example/private?X-Amz-Signature=checkpoint-private",
  },
  request: {
    providerUrl:
      "https://provider.example/private?X-Amz-Signature=request-private",
  },
  result: {
    processed: 2,
    warning:
      "Failed https://provider.example/private?X-Amz-Signature=result-private",
  },
  error:
    "Provider https://provider.example/private?X-Amz-Signature=error-private failed",
  createdAt: "2026-07-16T00:00:00.000Z",
  startedAt: "2026-07-16T00:01:00.000Z",
  completedAt: null,
};

function expectPublicJob(result: unknown) {
  expect(result).toMatchObject({
    job: {
      id: "job-1",
      sourceId: "source-1",
      result: { processed: 2, warning: "Failed [redacted]" },
      error: "Provider [redacted] failed",
    },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(
    /owner@example|org-secret|worker-private|lease-private|checkpoint-private|request-private|result-private|error-private|creative-context-blob|X-Amz-Signature/i,
  );
  expect(serialized).not.toMatch(
    /ownerEmail|orgId|leaseOwner|leaseToken|leaseExpiresAt|checkpoint|request|budget/i,
  );
}

describe("creative context job action serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.continueJob.mockResolvedValue(privateJob);
    mocks.createJob.mockResolvedValue(privateJob);
    mocks.getJob.mockResolvedValue({
      ...privateJob,
      kind: "purge",
    });
    mocks.getContextSource.mockResolvedValue({
      id: "source-1",
      ownerEmail: "owner@example.test",
    });
    mocks.purgeContextSourceArtifacts.mockResolvedValue({
      sourceId: "source-1",
      purgedItems: 2,
      purgedBlobs: 1,
    });
    mocks.updateJob.mockResolvedValue(privateJob);
  });

  it("redacts continuation job capabilities and provider URLs", async () => {
    expectPublicJob(await continueImport.run({ jobId: "job-1" }));
  });

  it("redacts newly queued import job capabilities and provider URLs", async () => {
    expectPublicJob(
      await startImport.run({
        sourceId: "source-1",
        mode: "incremental",
      }),
    );
    expect(mocks.dispatchCreativeContextImportJob).toHaveBeenCalledWith({
      jobId: "job-1",
      ownerEmail: "owner@example.test",
      orgId: "org-secret",
      appId: "slides",
    });
  });

  it("redacts newly queued enrichment job capabilities and provider URLs", async () => {
    expectPublicJob(
      await startEnrichment.run({
        sourceId: "source-1",
        operation: "enrich-media",
        eagerLimit: 25,
      }),
    );
  });

  it("redacts completed purge job capabilities and provider URLs", async () => {
    expectPublicJob(await processPurge.run({ jobId: "job-1" }));
  });
});
