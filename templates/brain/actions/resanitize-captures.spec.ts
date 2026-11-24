import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = {
  id: "capture-1",
  sourceId: "source-1",
  externalId: "external-1",
  title: "Weekly meeting",
  kind: "transcript",
  content: "The original safe transcript.",
  contentHash: "original-hash",
  metadataJson: "{}",
  capturedAt: "2026-07-19T00:00:00.000Z",
  status: "ready",
  sensitivityDisposition: "allowed",
  sensitivityPolicyVersion: "policy-v1",
  audienceAclHash: "audience-v1",
};
const source = {
  id: "source-1",
  title: "Meetings",
  provider: "granola",
  ownerEmail: "owner@example.test",
  visibility: "org",
  configJson: "{}",
};

const mocks = vi.hoisted(() => ({
  BrainCaptureConcurrentError: class extends Error {},
  BrainClassifierUnavailableError: class extends Error {},
  BrainUnsafeSourceIdentityError: class extends Error {},
  contentHash: vi.fn(async () => "changed-hash"),
  enqueueCaptureInvalidation: vi.fn(async () => undefined),
  getAccessibleCapture: vi.fn(),
  getDb: vi.fn(),
  invalidateDerivedForCapture: vi.fn(async () => undefined),
  recordBlockedCapture: vi.fn(async () => undefined),
  sanitizeCaptureForStorage: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ type: "access" })),
  assertAccess: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (value: unknown) => value,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
  like: (column: unknown, value: unknown) => ({ column, value }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    brainKnowledge: {
      captureId: "knowledge.captureId",
      evidenceJson: "knowledge.evidenceJson",
      id: "knowledge.id",
    },
    brainKnowledgeShares: {},
    brainProposals: {
      captureId: "proposal.captureId",
      evidenceJson: "proposal.evidenceJson",
      id: "proposal.id",
    },
    brainProposalShares: {},
    brainRawCaptures: {
      capturedAt: "capture.capturedAt",
      id: "capture.id",
      kind: "capture.kind",
      sensitivityDisposition: "capture.sensitivityDisposition",
      sourceId: "capture.sourceId",
      updatedAt: "capture.updatedAt",
    },
    brainSources: {},
  },
}));

vi.mock("../server/lib/audiences.js", () => ({
  ensureCaptureAudience: vi.fn(),
}));

vi.mock("../server/lib/brain.js", () => ({
  BrainCaptureConcurrentError: mocks.BrainCaptureConcurrentError,
  contentHash: mocks.contentHash,
  getAccessibleCapture: mocks.getAccessibleCapture,
  invalidateDerivedForCapture: mocks.invalidateDerivedForCapture,
  nowIso: () => "2026-07-19T01:00:00.000Z",
  parseJson: (value: string | null, fallback: unknown) =>
    value ? JSON.parse(value) : fallback,
  readBrainSettings: vi.fn(async () => ({})),
  recordBlockedCapture: mocks.recordBlockedCapture,
  stableJson: JSON.stringify,
}));

vi.mock("../server/lib/capture-sanitization.js", () => ({
  BrainClassifierUnavailableError: mocks.BrainClassifierUnavailableError,
  BrainUnsafeSourceIdentityError: mocks.BrainUnsafeSourceIdentityError,
  sanitizeCaptureForStorage: mocks.sanitizeCaptureForStorage,
}));

vi.mock("../server/lib/ingest-queue.js", () => ({
  enqueueCaptureInvalidation: mocks.enqueueCaptureInvalidation,
}));

vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (value: string) => value,
}));

import action from "./resanitize-captures.js";

function createDb() {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() =>
        Object.assign(Promise.resolve(undefined), {
          returning: vi.fn(async () => [{ id: capture.id }]),
        }),
      ),
    })),
  }));
  return {
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if ("id" in selection && table !== undefined) {
              if (selection.id === "capture.id") return [{ id: capture.id }];
              if (selection.id === "knowledge.id")
                return [{ id: "knowledge-1" }];
              if (selection.id === "proposal.id") return [{ id: "proposal-1" }];
            }
            return [];
          }),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => [{ id: capture.id }]),
        })),
      })),
    })),
    update,
  };
}

describe("resanitize-captures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(createDb());
    mocks.getAccessibleCapture.mockResolvedValue({
      capture,
      source,
      role: "editor",
    });
  });

  it("reports the real sanitizer method when rescreening a partial transcript", async () => {
    const actual = await vi.importActual<
      typeof import("../server/lib/capture-sanitization.js")
    >("../server/lib/capture-sanitization.js");
    const { DEFAULT_BRAIN_SETTINGS } = await import("../shared/types.js");
    mocks.getAccessibleCapture.mockResolvedValue({
      capture: {
        ...capture,
        content: "Decision: ship the API.\n[…]\nRoadmap launch is ready.",
        metadataJson: JSON.stringify({
          passageQuarantine: { version: 1, withheldPassages: 1 },
        }),
      },
      source,
      role: "editor",
    });
    mocks.sanitizeCaptureForStorage.mockImplementationOnce((input) =>
      actual.sanitizeCaptureForStorage({
        ...input,
        settings: {
          ...DEFAULT_BRAIN_SETTINGS,
          privacyClassifier: "deterministic",
        },
      }),
    );
    const result = await action.run({
      captureIds: [capture.id],
      limit: 25,
      dryRun: true,
      includeNonTranscript: false,
      allowCitationDrift: false,
    });
    expect(result.results[0]).toMatchObject({
      method: "deterministic",
      rawContentRetained: false,
    });
  });

  it("does not return the original locator for partial transcripts", async () => {
    const metadata = {
      passageQuarantine: { version: 1, withheldPassages: 1 },
      captureSanitization: { method: "jev" },
    };
    mocks.getAccessibleCapture.mockResolvedValue({
      capture: {
        ...capture,
        externalId: "https://example.test/full-transcript",
        metadataJson: JSON.stringify(metadata),
      },
      source,
      role: "editor",
    });
    mocks.sanitizeCaptureForStorage.mockResolvedValue({
      title: capture.title,
      content: "Safe excerpt.",
      metadata,
      decision: { disposition: "allowed", policyVersion: "policy-v2" },
    });
    const result = await action.run({
      captureIds: [capture.id],
      limit: 25,
      dryRun: true,
      includeNonTranscript: false,
      allowCitationDrift: false,
    });
    expect(result.results[0]).toMatchObject({
      externalId: null,
      method: "jev",
    });
  });

  it("does not rewrite or invalidate cited data by default when sanitization changes content", async () => {
    mocks.sanitizeCaptureForStorage.mockResolvedValue({
      title: capture.title,
      content: "A sanitized transcript.",
      metadata: { captureSanitization: { method: "deterministic" } },
      decision: { disposition: "allowed", policyVersion: "policy-v2" },
    });

    const result = await action.run({
      captureIds: [capture.id],
      limit: 25,
      dryRun: false,
      includeNonTranscript: false,
      allowCitationDrift: false,
    });

    expect(result.updated).toBe(0);
    expect(result.results[0]).toMatchObject({
      skipped: true,
      skipReason: "cited-derived-data",
      dependentKnowledgeIds: ["knowledge-1"],
      dependentProposalIds: ["proposal-1"],
    });
    expect(mocks.getDb().update).not.toHaveBeenCalled();
    expect(mocks.invalidateDerivedForCapture).not.toHaveBeenCalled();
    expect(mocks.enqueueCaptureInvalidation).not.toHaveBeenCalled();
  });

  it("does not block cited data by default when the tightened policy rejects it", async () => {
    mocks.sanitizeCaptureForStorage.mockResolvedValue({
      title: "Privacy-blocked capture",
      content: "",
      metadata: { captureSanitization: { method: "deterministic" } },
      decision: { disposition: "quarantined", policyVersion: "policy-v2" },
    });

    const result = await action.run({
      captureIds: [capture.id],
      limit: 25,
      dryRun: false,
      includeNonTranscript: false,
      allowCitationDrift: false,
    });

    expect(result.updated).toBe(0);
    expect(result.results[0]).toMatchObject({
      skipped: true,
      skipReason: "cited-derived-data",
    });
    expect(mocks.recordBlockedCapture).not.toHaveBeenCalled();
    expect(mocks.invalidateDerivedForCapture).not.toHaveBeenCalled();
    expect(mocks.enqueueCaptureInvalidation).not.toHaveBeenCalled();
  });

  it("reports a capture whose source identity is unsafe instead of aborting the batch", async () => {
    mocks.sanitizeCaptureForStorage.mockRejectedValue(
      new mocks.BrainUnsafeSourceIdentityError("unsafe source identity"),
    );

    const result = await action.run({
      captureIds: [capture.id],
      limit: 25,
      dryRun: false,
      includeNonTranscript: false,
      allowCitationDrift: true,
    });

    expect(result.updated).toBe(0);
    expect(result.results[0]).toMatchObject({
      id: capture.id,
      skipped: true,
      skipReason: "unsafe-source-identity",
    });
    expect(mocks.getDb().update).not.toHaveBeenCalled();
  });

  it("reports a capture whose screening is unavailable instead of aborting the batch", async () => {
    mocks.sanitizeCaptureForStorage.mockRejectedValue(
      new mocks.BrainClassifierUnavailableError("classifier unavailable"),
    );

    const result = await action.run({
      captureIds: [capture.id],
      limit: 25,
      dryRun: false,
      includeNonTranscript: false,
      allowCitationDrift: true,
    });

    expect(result.updated).toBe(0);
    expect(result.results[0]).toMatchObject({
      id: capture.id,
      skipped: true,
      skipReason: "screening-unavailable",
    });
  });
});
